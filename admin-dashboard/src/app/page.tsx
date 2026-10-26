
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

const API_URL = "https://admin-api.finallynomoreroborio.party";

// This is a frontend safety switch, not authorization.
// The server's ADMIN_API_ENABLED flag remains authoritative.
const WRITES_ENABLED =
    process.env.NEXT_PUBLIC_MODERATION_WRITES_ENABLED === "true";

type Incident = {
  id: string;
  story: string;
  status: "pending";
  created_at: string;
};

type QueueResponse = {
  status: string;
  incidents: Incident[];
  count: number;
};

type QueueState = "loading" | "connected" | "error";
type Decision = "approve" | "reject";

type PendingDecision = {
  incident: Incident;
  decision: Decision;
};

type ApiError = {
  error?: string;
};

function formatDate(value: string): string {
  // SQLite CURRENT_TIMESTAMP is UTC without a timezone suffix.
  const date = new Date(
      value.includes("T") || value.endsWith("Z")
          ? value
          : value.replace(" ", "T") + "Z"
  );

  return Number.isNaN(date.getTime())
      ? "DATE UNKNOWN"
      : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(date);
}

function formatCount(n: number): string {
  return String(n).padStart(3, "0");
}

function queueError(status: number): string {
  if (status === 401 || status === 403) {
    return "ACCESS SESSION EXPIRED OR DENIED. OPEN THE ADMIN API AND SIGN IN.";
  }

  if (status === 503) {
    return "THE MODERATION QUEUE IS TEMPORARILY UNAVAILABLE.";
  }

  return `UPSTREAM API RETURNED HTTP ${status}.`;
}

function reviewError(status: number, error?: string): string {
  if (status === 409 || error === "ALREADY_REVIEWED") {
    return "ANOTHER MODERATOR ALREADY REVIEWED THIS CASE. REFRESH THE QUEUE.";
  }

  if (status === 404) {
    return "THIS CASE NO LONGER EXISTS. REFRESH THE QUEUE.";
  }

  if (status === 401 || status === 403) {
    return "YOUR MODERATOR SESSION WAS DENIED OR EXPIRED. SIGN IN TO THE ADMIN API AGAIN.";
  }

  if (status === 503 && error === "ADMIN_API_DISABLED") {
    return "MODERATION IS LOCKED BY THE PRODUCTION SAFETY SWITCH.";
  }

  if (status === 503) {
    return "THE REVIEW SERVICE IS UNAVAILABLE. NO DECISION HAS BEEN CONFIRMED.";
  }

  return `REVIEW FAILED (HTTP ${status}). NO DECISION HAS BEEN CONFIRMED.`;
}

export default function Home() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [queueState, setQueueState] =
      useState<QueueState>("loading");

  const [errorMessage, setErrorMessage] = useState("");
  const [lastUpdated, setLastUpdated] =
      useState<Date | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] =
      useState<PendingDecision | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const [reviewErrorMessage, setReviewErrorMessage] =
      useState("");

  const [sessionApproved, setSessionApproved] = useState(0);
  const [sessionRejected, setSessionRejected] = useState(0);

  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const loadQueue = useCallback(
      async (signal?: AbortSignal) => {
        setRefreshing(true);

        try {
          const response = await fetch(
              `${API_URL}/api/admin/incidents`,
              {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                signal,
              }
          );

          if (!response.ok) {
            throw new Error(queueError(response.status));
          }

          const result: QueueResponse = await response.json();

          if (
              result.status !== "ok" ||
              !Array.isArray(result.incidents)
          ) {
            throw new Error(
                "THE API RETURNED AN INVALID QUEUE RESPONSE."
            );
          }

          if (signal?.aborted) return;

          setIncidents(result.incidents);
          setQueueState("connected");
          setErrorMessage("");
          setLastUpdated(new Date());
        } catch (error) {
          if (signal?.aborted) return;

          setQueueState("error");
          setErrorMessage(
              error instanceof Error
                  ? error.message
                  : "UNKNOWN CONNECTION FAILURE."
          );
        } finally {
          if (!signal?.aborted) {
            setRefreshing(false);
          }
        }
      },
      []
  );

  useEffect(() => {
    const controller = new AbortController();

    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void loadQueue(controller.signal);
      }
    });

    return () => controller.abort();
  }, [loadQueue]);

  useEffect(() => {
    if (!pending) return;

    const previouslyFocused =
        document.activeElement as HTMLElement | null;

    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        event.preventDefault();
        setPending(null);
      }

      if (event.key !== "Tab") return;

      const focusables =
          dialogRef.current?.querySelectorAll<HTMLButtonElement>(
              "button:not([disabled])"
          );

      if (!focusables?.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (
          event.shiftKey &&
          document.activeElement === first
      ) {
        event.preventDefault();
        last.focus();
      } else if (
          !event.shiftKey &&
          document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [pending, submitting]);

  function requestDecision(
      incident: Incident,
      decision: Decision
  ) {
    if (!WRITES_ENABLED || submitting) return;

    setReviewMessage("");
    setReviewErrorMessage("");
    setPending({ incident, decision });
  }

  async function confirmDecision() {
    if (!pending || !WRITES_ENABLED || submitting) return;

    const { incident, decision } = pending;

    setSubmitting(true);
    setReviewErrorMessage("");

    try {
      const response = await fetch(
          `${API_URL}/api/admin/incidents/${encodeURIComponent(
              incident.id
          )}/${decision}`,
          {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
            },
            body: "{}",
          }
      );

      let result: ApiError = {};

      try {
        result = (await response.json()) as ApiError;
      } catch {
        // Cloudflare Access may return HTML or no body.
      }

      if (!response.ok) {
        throw new Error(
            reviewError(response.status, result.error)
        );
      }

      setIncidents((current) =>
          current.filter((item) => item.id !== incident.id)
      );

      if (decision === "approve") {
        setSessionApproved((n) => n + 1);
      } else {
        setSessionRejected((n) => n + 1);
      }

      setPending(null);

      setReviewMessage(
          `CASE ${incident.id.slice(0, 8).toUpperCase()} ${
              decision === "approve" ? "APPROVED" : "REJECTED"
          }. DECISION RECORDED.`
      );

      void loadQueue();
    } catch (error) {
      setReviewErrorMessage(
          error instanceof Error
              ? error.message
              : "NETWORK FAILURE. CHECK CONNECTION AND REFRESH BEFORE RETRYING."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isConnected = queueState === "connected";
  const isLoading = queueState === "loading";

  return (
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <Link
              className={styles.brand}
              href="/"
              aria-label="Trauma Center home"
          >
          <span className={styles.brandMark}>
            R<span className={styles.brandBurst}>*</span>
          </span>

            <span className={styles.brandWords}>
            <strong>
              TRAUMA
              <br />
              CENTER
            </strong>
            <small>ROBORIO INCIDENT DIVISION</small>
          </span>
          </Link>

          <div className={styles.navGroup}>
          <span className={styles.navLabel}>
            OPERATIONS
          </span>

            <nav aria-label="Dashboard navigation">
              <Link
                  href="/"
                  className={styles.activeNav}
                  aria-current="page"
              >
                <span>01</span>
                <strong>Review queue</strong>
                <span aria-hidden="true">↗</span>
              </Link>

              <span className={styles.inactiveNav}>
              <span>02</span>
              Incident archive
              <small>SOON</small>
            </span>

              <span className={styles.inactiveNav}>
              <span>03</span>
              System diagnostics
              <small>SOON</small>
            </span>
            </nav>
          </div>

          <div className={styles.sidebarBottom}>
            <div className={styles.sidePoster}>
              <span>SYSTEMCORE / TRANSITION</span>

              <strong>
                LEGACY HARDWARE
                <br />
                RETIREMENT UNIT
              </strong>

              <div
                  className={styles.signalBars}
                  aria-hidden="true"
              >
                {[9, 15, 24, 16, 10, 24, 12, 17].map(
                    (height, index) => (
                        <i
                            key={index}
                            style={{ height }}
                        />
                    )
                )}
              </div>
            </div>

            <p className={styles.disclaimer}>
              UNOFFICIAL FRC PARODY
              <br />
              NOT AN ACTUAL GOVERNMENT AGENCY
            </p>
          </div>
        </aside>

        <div className={styles.workspace}>
          <header className={styles.topbar}>
          <span>
            OPERATIONS <i>/</i> INCIDENT REVIEW
          </span>

            <span className={styles.topbarRight}>
            <span
                className={
                  WRITES_ENABLED
                      ? styles.writeMode
                      : styles.readOnly
                }
            >
              {WRITES_ENABLED
                  ? "REVIEW UI ENABLED"
                  : "READ-ONLY MODE"}
            </span>

            <i />
            OPERATOR / VERIFIED ACCESS
          </span>
          </header>

          <main className={styles.main}>
            <div className={styles.eyebrow}>
              <span />
              DIVISION 4256 · CLASSIFIED-ISH
            </div>

            <div className={styles.hero}>
              <div>
                <h1>
                  INCIDENT
                  <br />
                  <em>COMMAND.</em>
                </h1>

                <p>
                  Every disconnect has a story.
                  Every story deserves a case number.
                </p>
              </div>

              <div
                  className={styles.stamp}
                  aria-label="Legacy roboRIO recovery"
              >
                <span>LEGACY</span>
                <strong>RIO</strong>
                <span>RECOVERY</span>
              </div>
            </div>

            <section
                className={styles.metrics}
                aria-label="Queue status"
            >
              <div className={styles.primaryMetric}>
                <span>AWAITING JUDGMENT</span>

                <strong aria-live="polite">
                  {isConnected
                      ? formatCount(incidents.length)
                      : "---"}
                </strong>

                <small>
                  {isConnected
                      ? "LIVE PENDING REPORTS"
                      : "AWAITING TELEMETRY"}
                </small>
              </div>

              <div className={styles.metric}>
                <span>APPROVED</span>
                <strong>
                  {formatCount(sessionApproved)}
                </strong>
                <small>THIS DASHBOARD SESSION</small>
              </div>

              <div className={styles.metric}>
                <span>REJECTED</span>
                <strong>
                  {formatCount(sessionRejected)}
                </strong>
                <small>THIS DASHBOARD SESSION</small>
              </div>

              <div className={styles.metric}>
                <span>SYSTEM STATUS</span>

                <strong
                    className={
                      isConnected
                          ? styles.connectedText
                          : queueState === "error"
                              ? styles.errorText
                              : styles.statusText
                    }
                >
                  <span aria-hidden="true">● </span>
                  {isConnected
                      ? "ONLINE"
                      : isLoading
                          ? "CONNECTING"
                          : "OFFLINE"}
                </strong>

                <small>
                  {isConnected
                      ? "D1 QUEUE CONNECTED"
                      : "ADMIN API"}
                </small>
              </div>
            </section>

            <section
                className={styles.queueSection}
                aria-labelledby="queue-title"
            >
              <div className={styles.sectionHeader}>
                <div>
                <span className={styles.sectionIndex}>
                  01 / EVIDENCE INTAKE
                </span>

                  <h2 id="queue-title">
                    THE REVIEW QUEUE
                    <sup>®</sup>
                  </h2>
                </div>

                <div className={styles.queueActions}>
                <span>
                  DISPLAYING{" "}
                  <strong>
                    {isConnected
                        ? formatCount(incidents.length)
                        : "---"}
                  </strong>
                </span>

                  <button
                      className={styles.refreshButton}
                      type="button"
                      onClick={() => void loadQueue()}
                      disabled={refreshing || submitting}
                  >
                    {refreshing
                        ? "SYNCING..."
                        : "↻ REFRESH"}
                  </button>
                </div>
              </div>

              <div
                  className={
                    WRITES_ENABLED
                        ? styles.noticeReady
                        : styles.notice
                  }
              >
                <strong>
                  {WRITES_ENABLED
                      ? "REVIEW CONTROLS ARMED"
                      : "READ-ONLY OPERATION"}
                </strong>

                <span>
                {WRITES_ENABLED
                    ? "Every decision needs confirmation and is recorded by the API. Server-side authorization remains mandatory."
                    : "Live submissions are displayed below. Review actions remain locked until production authorization is finalized."}
              </span>
              </div>

              {reviewMessage && (
                  <div
                      role="status"
                      className={styles.successBanner}
                  >
                    {reviewMessage}
                  </div>
              )}

              {reviewErrorMessage && !pending && (
                  <div
                      role="alert"
                      className={styles.errorBanner}
                  >
                    {reviewErrorMessage}
                  </div>
              )}

              {isLoading && (
                  <div
                      className={styles.statePanel}
                      role="status"
                  >
                <span className={styles.stateSymbol}>
                  ...
                </span>

                    <strong>
                      ESTABLISHING SECURE CONNECTION
                    </strong>

                    <p>
                      Requesting classified roboRIO trauma
                      reports from the moderation server.
                    </p>
                  </div>
              )}

              {queueState === "error" && (
                  <div
                      className={styles.statePanel}
                      role="alert"
                  >
                <span className={styles.stateSymbol}>
                  !
                </span>

                    <strong>
                      COMMUNICATIONS FAILURE
                    </strong>

                    <p>{errorMessage}</p>

                    <div className={styles.errorActions}>
                      <button
                          type="button"
                          onClick={() => void loadQueue()}
                      >
                        RETRY CONNECTION ↗
                      </button>

                      <a
                          href={`${API_URL}/api/health`}
                          target="_blank"
                          rel="noopener noreferrer"
                      >
                        OPEN API LOGIN ↗
                      </a>
                    </div>
                  </div>
              )}

              {isConnected &&
                  incidents.length === 0 && (
                      <div
                          className={styles.statePanel}
                          role="status"
                      >
                  <span className={styles.stateSymbol}>
                    Ø
                  </span>

                        <strong>
                          NO CASES AWAITING REVIEW
                        </strong>

                        <p>
                          The roboRIO has caused no officially
                          documented emotional damage. Yet.
                        </p>

                        <span
                            className={styles.emptyFootnote}
                        >
                    FILES CLEARED /
                    SUSPICIOUSLY PEACEFUL
                  </span>
                      </div>
                  )}

              {isConnected &&
                  incidents.length > 0 && (
                      <div className={styles.caseList}>
                        {incidents.map((incident, index) => (
                            <article
                                className={styles.case}
                                key={incident.id}
                            >
                              <div
                                  className={styles.caseNumber}
                              >
                                <span>CASE FILE</span>

                                <strong>
                                  {formatCount(index + 1)}
                                </strong>

                                <i />
                                <small>UNREVIEWED</small>
                              </div>

                              <div className={styles.caseBody}>
                                <div
                                    className={styles.caseMeta}
                                >
                          <span>
                            UNCLASSIFIED RIO INCIDENT
                          </span>

                                  <time
                                      dateTime={
                                        incident.created_at
                                      }
                                  >
                                    {formatDate(
                                        incident.created_at
                                    )}
                                  </time>
                                </div>

                                <p>{incident.story}</p>

                                <div
                                    className={styles.caseFooter}
                                >
                          <span>
                            STATUS:{" "}
                            <strong>
                              PENDING REVIEW
                            </strong>
                          </span>

                                  <span>
                            CASE ID /{" "}
                                    {incident.id.slice(0, 8)}
                          </span>
                                </div>
                              </div>

                              <div
                                  className={styles.caseControls}
                              >
                                <button
                                    type="button"
                                    className={
                                      styles.approveButton
                                    }
                                    disabled={
                                        !WRITES_ENABLED ||
                                        submitting
                                    }
                                    onClick={() =>
                                        requestDecision(
                                            incident,
                                            "approve"
                                        )
                                    }
                                >
                                  ↗ APPROVE
                                </button>

                                <button
                                    type="button"
                                    className={
                                      styles.rejectButton
                                    }
                                    disabled={
                                        !WRITES_ENABLED ||
                                        submitting
                                    }
                                    onClick={() =>
                                        requestDecision(
                                            incident,
                                            "reject"
                                        )
                                    }
                                >
                                  × REJECT
                                </button>

                                <small>
                                  {WRITES_ENABLED
                                      ? "CONFIRMATION REQUIRED"
                                      : "ACTIONS LOCKED"}
                                </small>
                              </div>
                            </article>
                        ))}
                      </div>
                  )}

              <div className={styles.queueFooter}>
              <span>
                {lastUpdated
                    ? `LAST SYNC / ${lastUpdated.toLocaleTimeString()}`
                    : "AWAITING FIRST SYNC"}
              </span>

                <span>
                {isConnected
                    ? "AUTHENTICATED CHANNEL"
                    : "CONNECTION UNVERIFIED"}
              </span>
              </div>
            </section>

            <footer className={styles.footer}>
            <span>
              © 2026 ROBORIO TRAUMA CENTER
            </span>
              <span>
              IN MEMORY OF EVERY LOST NETWORKTABLE UPDATE
            </span>
              <span>BUILD / PRODUCTION</span>
            </footer>
          </main>
        </div>

        {pending && (
            <div className={styles.modalBackdrop}>
              <div
                  className={styles.modal}
                  ref={dialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="decision-title"
                  aria-describedby="decision-description"
              >
                <div className={styles.modalAccent} />

                <span className={styles.modalKicker}>
              TRAUMA CENTER // FINAL JUDGMENT
            </span>

                <h2 id="decision-title">
                  {pending.decision === "approve"
                      ? "MAKE IT OFFICIAL."
                      : "DENY THE ALLEGATIONS."}
                </h2>

                <p id="decision-description">
                  {pending.decision === "approve"
                      ? "Approve this incident and remove it from the pending queue?"
                      : "Reject this incident and remove it from the pending queue?"}
                  {" "}
                  The decision is permanent under the
                  current one-review policy and will be logged
                  with your verified moderator identity.
                </p>

                <div className={styles.modalCase}>
              <span>
                CASE /{" "}
                {pending.incident.id
                    .slice(0, 8)
                    .toUpperCase()}
              </span>

                  <p>{pending.incident.story}</p>
                </div>

                {reviewErrorMessage && (
                    <div
                        className={styles.modalError}
                        role="alert"
                    >
                      {reviewErrorMessage}
                    </div>
                )}

                <div className={styles.modalActions}>
                  <button
                      type="button"
                      className={styles.cancelButton}
                      ref={cancelRef}
                      disabled={submitting}
                      onClick={() => {
                        setPending(null);
                        setReviewErrorMessage("");
                      }}
                  >
                    CANCEL
                  </button>

                  <button
                      type="button"
                      className={
                        pending.decision === "approve"
                            ? styles.confirmApprove
                            : styles.confirmReject
                      }
                      disabled={submitting}
                      onClick={() =>
                          void confirmDecision()
                      }
                  >
                    {submitting
                        ? "TRANSMITTING..."
                        : pending.decision === "approve"
                            ? "CONFIRM APPROVAL ↗"
                            : "CONFIRM REJECTION ×"}
                  </button>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}
