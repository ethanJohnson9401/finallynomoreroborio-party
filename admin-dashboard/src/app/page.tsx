
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

const API_URL = "https://admin-api.finallynomoreroborio.party";
const PAGE_SIZE = 25;

// Frontend safety switch only.
// Server-side authentication and ADMIN_API_ENABLED remain authoritative.
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
  total: number;
  nextCursor: string | null;
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

function formatCount(value: number): string {
  return String(value).padStart(3, "0");
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

function reviewError(
    status: number,
    error?: string
): string {
  if (status === 409 || error === "ALREADY_REVIEWED") {
    return "ANOTHER MODERATOR ALREADY REVIEWED THIS CASE. REFRESH THE QUEUE.";
  }

  if (status === 404) {
    return "THIS CASE NO LONGER EXISTS. REFRESH THE QUEUE.";
  }

  if (status === 401 || status === 403) {
    return "YOUR MODERATOR SESSION WAS DENIED OR EXPIRED. SIGN IN TO THE ADMIN API AGAIN.";
  }

  if (
      status === 503 &&
      error === "ADMIN_API_DISABLED"
  ) {
    return "MODERATION IS LOCKED BY THE PRODUCTION SAFETY SWITCH.";
  }

  if (status === 503) {
    return "THE REVIEW SERVICE IS UNAVAILABLE. NO DECISION HAS BEEN CONFIRMED.";
  }

  return `REVIEW FAILED (HTTP ${status}). NO DECISION HAS BEEN CONFIRMED.`;
}

/**
 * Validate the structure of a queue response.
 */
function isQueueResponse(
    value: unknown
): value is QueueResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Partial<QueueResponse>;

  return (
      result.status === "ok" &&
      Array.isArray(result.incidents) &&
      result.incidents.every(
          (incident) =>
              incident !== null &&
              typeof incident === "object" &&
              typeof incident.id === "string" &&
              typeof incident.story === "string" &&
              incident.status === "pending" &&
              typeof incident.created_at === "string"
      ) &&
      typeof result.count === "number" &&
      result.count === result.incidents.length &&
      typeof result.total === "number" &&
      Number.isInteger(result.total) &&
      result.total >= 0 &&
      (result.nextCursor === null ||
          typeof result.nextCursor === "string")
  );
}

/**
 * Fetch an authenticated page from the Admin API.
 */
async function fetchQueuePage(
    cursor?: string,
    signal?: AbortSignal
): Promise<QueueResponse> {
  const url = new URL(
      "/api/admin/incidents",
      API_URL
  );

  url.searchParams.set(
      "limit",
      String(PAGE_SIZE)
  );

  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(queueError(response.status));
  }

  const result: unknown = await response.json();

  if (!isQueueResponse(result)) {
    throw new Error(
        "THE API RETURNED AN INVALID QUEUE RESPONSE."
    );
  }

  return result;
}

export default function Home() {
  const [incidents, setIncidents] =
      useState<Incident[]>([]);

  const [totalPending, setTotalPending] =
      useState(0);

  const [nextCursor, setNextCursor] =
      useState<string | null>(null);

  const [queueState, setQueueState] =
      useState<QueueState>("loading");

  const [errorMessage, setErrorMessage] =
      useState("");

  const [lastUpdated, setLastUpdated] =
      useState<Date | null>(null);

  const [refreshing, setRefreshing] =
      useState(false);

  const [loadingMore, setLoadingMore] =
      useState(false);

  const [paginationError, setPaginationError] =
      useState<string | null>(null);

  const [pending, setPending] =
      useState<PendingDecision | null>(null);

  const [submitting, setSubmitting] =
      useState(false);

  const [reviewMessage, setReviewMessage] =
      useState("");

  const [reviewErrorMessage, setReviewErrorMessage] =
      useState("");

  const [sessionApproved, setSessionApproved] =
      useState(0);

  const [sessionRejected, setSessionRejected] =
      useState(0);

  const cancelRef =
      useRef<HTMLButtonElement>(null);

  const dialogRef =
      useRef<HTMLDivElement>(null);

  /**
   * Request generation lets us discard older
   * pagination responses after a refresh.
   */
  const queueRequestId = useRef(0);

  /**
   * Prevent simultaneous Load More requests.
   */
  const loadMoreInProgress = useRef(false);

  const mountedRef = useRef(false);

  /**
   * Load the first page of the current queue.
   *
   * Refreshing resets pagination intentionally.
   */
  const loadQueue = useCallback(
      async (signal?: AbortSignal) => {
        const requestId =
            ++queueRequestId.current;

        setRefreshing(true);
        setPaginationError(null);

        try {
          const result = await fetchQueuePage(
              undefined,
              signal
          );

          if (
              signal?.aborted ||
              requestId !== queueRequestId.current ||
              !mountedRef.current
          ) {
            return;
          }

          setIncidents(result.incidents);
          setTotalPending(result.total);
          setNextCursor(result.nextCursor);

          setQueueState("connected");
          setErrorMessage("");
          setLastUpdated(new Date());
        } catch (error) {
          if (
              signal?.aborted ||
              requestId !== queueRequestId.current ||
              !mountedRef.current
          ) {
            return;
          }

          setQueueState("error");

          setErrorMessage(
              error instanceof Error
                  ? error.message
                  : "UNKNOWN CONNECTION FAILURE."
          );
        } finally {
          if (
              !signal?.aborted &&
              requestId === queueRequestId.current &&
              mountedRef.current
          ) {
            setRefreshing(false);
          }
        }
      },
      []
  );

  /**
   * Fetch the next page and append only
   * incidents not already displayed.
   */
  async function loadMoreCases() {
    if (
        !nextCursor ||
        loadMoreInProgress.current ||
        refreshing ||
        submitting ||
        queueState !== "connected"
    ) {
      return;
    }

    const requestId =
        queueRequestId.current;

    const cursor = nextCursor;

    loadMoreInProgress.current = true;
    setLoadingMore(true);
    setPaginationError(null);

    try {
      const result =
          await fetchQueuePage(cursor);

      if (
          !mountedRef.current ||
          requestId !== queueRequestId.current
      ) {
        return;
      }

      setIncidents((current) => {
        const existingIds = new Set(
            current.map(
                (incident) => incident.id
            )
        );

        const newIncidents =
            result.incidents.filter(
                (incident) =>
                    !existingIds.has(
                        incident.id
                    )
            );

        return [
          ...current,
          ...newIncidents,
        ];
      });

      setTotalPending(result.total);
      setNextCursor(result.nextCursor);
      setLastUpdated(new Date());
    } catch (error) {
      if (
          mountedRef.current &&
          requestId === queueRequestId.current
      ) {
        setPaginationError(
            error instanceof Error
                ? error.message
                : "COULD NOT RETRIEVE OLDER CASE FILES."
        );
      }
    } finally {
      loadMoreInProgress.current = false;

      if (mountedRef.current) {
        setLoadingMore(false);
      }
    }
  }

  /**
   * Initial dashboard connection.
   */
  useEffect(() => {
    mountedRef.current = true;

    const controller =
        new AbortController();

    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void loadQueue(controller.signal);
      }
    });

    return () => {
      mountedRef.current = false;
      queueRequestId.current += 1;
      controller.abort();
    };
  }, [loadQueue]);

  /**
   * Manage focus and keyboard navigation
   * inside the decision confirmation dialog.
   */
  useEffect(() => {
    if (!pending) {
      return;
    }

    const previouslyFocused =
        document.activeElement as
            | HTMLElement
            | null;

    cancelRef.current?.focus();

    const onKeyDown = (
        event: KeyboardEvent
    ) => {
      if (
          event.key === "Escape" &&
          !submitting
      ) {
        event.preventDefault();
        setPending(null);
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusables =
          dialogRef.current
              ?.querySelectorAll<HTMLButtonElement>(
                  "button:not([disabled])"
              );

      if (!focusables?.length) {
        return;
      }

      const first = focusables[0];
      const last =
          focusables[focusables.length - 1];

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

    document.addEventListener(
        "keydown",
        onKeyDown
    );

    return () => {
      document.removeEventListener(
          "keydown",
          onKeyDown
      );

      previouslyFocused?.focus();
    };
  }, [pending, submitting]);

  /**
   * Open a moderator confirmation dialog.
   */
  function requestDecision(
      incident: Incident,
      decision: Decision
  ) {
    if (
        !WRITES_ENABLED ||
        submitting ||
        refreshing ||
        loadingMore
    ) {
      return;
    }

    setReviewMessage("");
    setReviewErrorMessage("");

    setPending({
      incident,
      decision,
    });
  }

  /**
   * Submit a permanent review decision.
   *
   * Only update local session counters after
   * the API confirms success.
   */
  async function confirmDecision() {
    if (
        !pending ||
        !WRITES_ENABLED ||
        submitting
    ) {
      return;
    }

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
              "Content-Type":
                  "application/json",
            },
            body: "{}",
          }
      );

      let result: ApiError = {};

      try {
        result =
            (await response.json()) as ApiError;
      } catch {
        // Access may return HTML instead.
      }

      if (!response.ok) {
        throw new Error(
            reviewError(
                response.status,
                result.error
            )
        );
      }

      /**
       * Remove the reviewed incident
       * immediately from the current list.
       */
      setIncidents((current) =>
          current.filter(
              (item) =>
                  item.id !== incident.id
          )
      );

      setTotalPending((current) =>
          Math.max(0, current - 1)
      );

      if (decision === "approve") {
        setSessionApproved(
            (current) => current + 1
        );
      } else {
        setSessionRejected(
            (current) => current + 1
        );
      }

      setPending(null);

      setReviewMessage(
          `CASE ${incident.id
              .slice(0, 8)
              .toUpperCase()} ${
              decision === "approve"
                  ? "APPROVED"
                  : "REJECTED"
          }. DECISION RECORDED.`
      );

      /**
       * Refresh from the newest page.
       *
       * This also avoids continuing from a
       * stale pagination cursor after review.
       */
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

  const isConnected =
      queueState === "connected";

  const isLoading =
      queueState === "loading";

  const canReview =
      WRITES_ENABLED &&
      !submitting &&
      !refreshing &&
      !loadingMore;

  return (
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <Link
              className={styles.brand}
              href="/"
              aria-label="Trauma Center home"
          >
                    <span
                        className={styles.brandMark}
                    >
                        R
                        <span
                            className={
                              styles.brandBurst
                            }
                        >
                            *
                        </span>
                    </span>

            <span
                className={styles.brandWords}
            >
                        <strong>
                            TRAUMA
                            <br />
                            CENTER
                        </strong>

                        <small>
                            ROBORIO INCIDENT DIVISION
                        </small>
                    </span>
          </Link>

          <div
              className={styles.navGroup}
          >
                    <span
                        className={styles.navLabel}
                    >
                        OPERATIONS
                    </span>

            <nav
                aria-label="Dashboard navigation"
            >
              <Link
                  href="/"
                  className={
                    styles.activeNav
                  }
                  aria-current="page"
              >
                <span>01</span>
                <strong>
                  Review queue
                </strong>
                <span aria-hidden="true">
                                ↗
                            </span>
              </Link>

              <span
                  className={
                    styles.inactiveNav
                  }
              >
                            <span>02</span>
                            Incident archive
                            <small>SOON</small>
                        </span>

              <span
                  className={
                    styles.inactiveNav
                  }
              >
                            <span>03</span>
                            System diagnostics
                            <small>SOON</small>
                        </span>
            </nav>
          </div>

          <div
              className={
                styles.sidebarBottom
              }
          >
            <div
                className={
                  styles.sidePoster
                }
            >
                        <span>
                            SYSTEMCORE / TRANSITION
                        </span>

              <strong>
                LEGACY HARDWARE
                <br />
                RETIREMENT UNIT
              </strong>

              <div
                  className={
                    styles.signalBars
                  }
                  aria-hidden="true"
              >
                {[
                  9, 15, 24, 16,
                  10, 24, 12, 17,
                ].map(
                    (height, index) => (
                        <i
                            key={index}
                            style={{
                              height,
                            }}
                        />
                    )
                )}
              </div>
            </div>

            <p
                className={
                  styles.disclaimer
                }
            >
              UNOFFICIAL FRC PARODY
              <br />
              NOT AN ACTUAL GOVERNMENT
              AGENCY
            </p>
          </div>
        </aside>

        <div className={styles.workspace}>
          <header
              className={styles.topbar}
          >
                    <span>
                        OPERATIONS <i>/</i>{" "}
                      INCIDENT REVIEW
                    </span>

            <span
                className={
                  styles.topbarRight
                }
            >
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
            <div
                className={styles.eyebrow}
            >
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
                  Every disconnect has
                  a story. Every story
                  deserves a case number.
                </p>
              </div>

              <div
                  className={
                    styles.stamp
                  }
                  aria-label="Legacy roboRIO recovery"
              >
                <span>LEGACY</span>
                <strong>RIO</strong>
                <span>RECOVERY</span>
              </div>
            </div>

            <section
                className={
                  styles.metrics
                }
                aria-label="Queue status"
            >
              <div
                  className={
                    styles.primaryMetric
                  }
              >
                            <span>
                                AWAITING JUDGMENT
                            </span>

                <strong
                    aria-live="polite"
                >
                  {isConnected
                      ? formatCount(
                          totalPending
                      )
                      : "---"}
                </strong>

                <small>
                  {isConnected
                      ? "TOTAL PENDING REPORTS"
                      : "AWAITING TELEMETRY"}
                </small>
              </div>

              <div
                  className={styles.metric}
              >
                <span>APPROVED</span>

                <strong>
                  {formatCount(
                      sessionApproved
                  )}
                </strong>

                <small>
                  THIS DASHBOARD SESSION
                </small>
              </div>

              <div
                  className={styles.metric}
              >
                <span>REJECTED</span>

                <strong>
                  {formatCount(
                      sessionRejected
                  )}
                </strong>

                <small>
                  THIS DASHBOARD SESSION
                </small>
              </div>

              <div
                  className={styles.metric}
              >
                            <span>
                                SYSTEM STATUS
                            </span>

                <strong
                    className={
                      isConnected
                          ? styles.connectedText
                          : queueState ===
                          "error"
                              ? styles.errorText
                              : styles.statusText
                    }
                >
                                <span
                                    aria-hidden="true"
                                >
                                    ●{" "}
                                </span>

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
                className={
                  styles.queueSection
                }
                aria-labelledby="queue-title"
            >
              <div
                  className={
                    styles.sectionHeader
                  }
              >
                <div>
                                <span
                                    className={
                                      styles.sectionIndex
                                    }
                                >
                                    01 / EVIDENCE INTAKE
                                </span>

                  <h2 id="queue-title">
                    THE REVIEW QUEUE
                    <sup>®</sup>
                  </h2>
                </div>

                <div
                    className={
                      styles.queueActions
                    }
                >
                                <span>
                                    DISPLAYING{" "}
                                  <strong>
                                        {isConnected
                                            ? formatCount(
                                                incidents.length
                                            )
                                            : "---"}
                                    </strong>
                                </span>

                  <button
                      className={
                        styles.refreshButton
                      }
                      type="button"
                      onClick={() =>
                          void loadQueue()
                      }
                      disabled={
                          refreshing ||
                          loadingMore ||
                          submitting
                      }
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
                      className={
                        styles.successBanner
                      }
                  >
                    {reviewMessage}
                  </div>
              )}

              {reviewErrorMessage &&
                  !pending && (
                      <div
                          role="alert"
                          className={
                            styles.errorBanner
                          }
                      >
                        {reviewErrorMessage}
                      </div>
                  )}

              {isLoading && (
                  <div
                      className={
                        styles.statePanel
                      }
                      role="status"
                  >
                                <span
                                    className={
                                      styles.stateSymbol
                                    }
                                >
                                    ...
                                </span>

                    <strong>
                      ESTABLISHING SECURE
                      CONNECTION
                    </strong>

                    <p>
                      Requesting classified
                      roboRIO trauma
                      reports from the
                      moderation server.
                    </p>
                  </div>
              )}

              {queueState ===
                  "error" && (
                      <div
                          className={
                            styles.statePanel
                          }
                          role="alert"
                      >
                                <span
                                    className={
                                      styles.stateSymbol
                                    }
                                >
                                    !
                                </span>

                        <strong>
                          COMMUNICATIONS
                          FAILURE
                        </strong>

                        <p>
                          {errorMessage}
                        </p>

                        <div
                            className={
                              styles.errorActions
                            }
                        >
                          <button
                              type="button"
                              onClick={() =>
                                  void loadQueue()
                              }
                              disabled={
                                refreshing
                              }
                          >
                            RETRY
                            CONNECTION ↗
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
                          className={
                            styles.statePanel
                          }
                          role="status"
                      >
                                    <span
                                        className={
                                          styles.stateSymbol
                                        }
                                    >
                                        Ø
                                    </span>

                        <strong>
                          NO CASES AWAITING
                          REVIEW
                        </strong>

                        <p>
                          The roboRIO has
                          caused no officially
                          documented emotional
                          damage. Yet.
                        </p>

                        <span
                            className={
                              styles.emptyFootnote
                            }
                        >
                                        FILES CLEARED /
                                        SUSPICIOUSLY
                                        PEACEFUL
                                    </span>
                      </div>
                  )}

              {isConnected &&
                  incidents.length > 0 && (
                      <div
                          className={
                            styles.caseList
                          }
                      >
                        {incidents.map(
                            (
                                incident,
                                index
                            ) => (
                                <article
                                    className={
                                      styles.case
                                    }
                                    key={
                                      incident.id
                                    }
                                >
                                  <div
                                      className={
                                        styles.caseNumber
                                      }
                                  >
                                                    <span>
                                                        CASE
                                                        FILE
                                                    </span>

                                    <strong>
                                      {formatCount(
                                          index +
                                          1
                                      )}
                                    </strong>

                                    <i />

                                    <small>
                                      UNREVIEWED
                                    </small>
                                  </div>

                                  <div
                                      className={
                                        styles.caseBody
                                      }
                                  >
                                    <div
                                        className={
                                          styles.caseMeta
                                        }
                                    >
                                                        <span>
                                                            UNCLASSIFIED
                                                            RIO
                                                            INCIDENT
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

                                    <p>
                                      {
                                        incident.story
                                      }
                                    </p>

                                    <div
                                        className={
                                          styles.caseFooter
                                        }
                                    >
                                                        <span>
                                                            STATUS:{" "}
                                                          <strong>
                                                                PENDING
                                                                REVIEW
                                                            </strong>
                                                        </span>

                                      <span>
                                                            CASE
                                                            ID
                                                            /{" "}
                                        {incident.id.slice(
                                            0,
                                            8
                                        )}
                                                        </span>
                                    </div>
                                  </div>

                                  <div
                                      className={
                                        styles.caseControls
                                      }
                                  >
                                    <button
                                        type="button"
                                        className={
                                          styles.approveButton
                                        }
                                        disabled={
                                          !canReview
                                        }
                                        onClick={() =>
                                            requestDecision(
                                                incident,
                                                "approve"
                                            )
                                        }
                                    >
                                      ↗
                                      APPROVE
                                    </button>

                                    <button
                                        type="button"
                                        className={
                                          styles.rejectButton
                                        }
                                        disabled={
                                          !canReview
                                        }
                                        onClick={() =>
                                            requestDecision(
                                                incident,
                                                "reject"
                                            )
                                        }
                                    >
                                      ×
                                      REJECT
                                    </button>

                                    <small>
                                      {WRITES_ENABLED
                                          ? "CONFIRMATION REQUIRED"
                                          : "ACTIONS LOCKED"}
                                    </small>
                                  </div>
                                </article>
                            )
                        )}
                      </div>
                  )}

              {isConnected && (
                  <div
                      style={{
                        display: "flex",
                        flexDirection:
                            "column",
                        alignItems:
                            "center",
                        gap: "14px",
                        padding:
                            "28px 16px",
                        borderBottom:
                            "1px solid #394039",
                      }}
                  >
                    <p
                        aria-live="polite"
                        style={{
                          margin: 0,
                          fontFamily:
                              '"DM Mono", monospace',
                          fontSize:
                              "11px",
                          color:
                              "#a0a99e",
                          textAlign:
                              "center",
                        }}
                    >
                      DISPLAYING{" "}
                      {formatCount(
                          incidents.length
                      )}{" "}
                      /{" "}
                      {formatCount(
                          totalPending
                      )}{" "}
                      PENDING CASE FILES
                    </p>

                    {nextCursor && (
                        <button
                            type="button"
                            onClick={() =>
                                void loadMoreCases()
                            }
                            disabled={
                                loadingMore ||
                                refreshing ||
                                submitting
                            }
                            aria-busy={
                              loadingMore
                            }
                            style={{
                              width:
                                  "min(100%, 380px)",
                              minHeight:
                                  "54px",
                              padding:
                                  "14px 22px",
                              border:
                                  "1px solid #c4f34c",
                              background:
                                  "transparent",
                              color:
                                  "#c4f34c",
                              fontFamily:
                                  '"DM Mono", monospace',
                              fontSize:
                                  "12px",
                              fontWeight:
                                  700,
                              letterSpacing:
                                  "0.7px",
                              cursor:
                                  loadingMore
                                      ? "wait"
                                      : "pointer",
                              opacity:
                                  loadingMore
                                      ? 0.6
                                      : 1,
                            }}
                        >
                          {loadingMore
                              ? "↻ RETRIEVING CASE FILES..."
                              : "↓ LOAD MORE CASE FILES"}
                        </button>
                    )}

                    {paginationError && (
                        <p
                            role="alert"
                            style={{
                              color:
                                  "#ff9878",
                              fontSize:
                                  "12px",
                              textAlign:
                                  "center",
                            }}
                        >
                          {
                            paginationError
                          }
                        </p>
                    )}

                    {!nextCursor &&
                        incidents.length >
                        0 && (
                            <span
                                style={{
                                  fontFamily:
                                      '"DM Mono", monospace',
                                  fontSize:
                                      "10px",
                                  color:
                                      "#a0a99e",
                                }}
                            >
                                            END OF
                                            CLASSIFIED
                                            ARCHIVE
                                        </span>
                        )}
                  </div>
              )}

              <div
                  className={
                    styles.queueFooter
                  }
              >
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

            <footer
                className={styles.footer}
            >
                        <span>
                            © 2026 ROBORIO
                            TRAUMA CENTER
                        </span>

              <span>
                            IN MEMORY OF EVERY
                            LOST NETWORKTABLE
                            UPDATE
                        </span>

              <span>
                            BUILD / PRODUCTION
                        </span>
            </footer>
          </main>
        </div>

        {pending && (
            <div
                className={
                  styles.modalBackdrop
                }
            >
              <div
                  className={styles.modal}
                  ref={dialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="decision-title"
                  aria-describedby="decision-description"
              >
                <div
                    className={
                      styles.modalAccent
                    }
                />

                <span
                    className={
                      styles.modalKicker
                    }
                >
                            TRAUMA CENTER // FINAL
                            JUDGMENT
                        </span>

                <h2 id="decision-title">
                  {pending.decision ===
                  "approve"
                      ? "MAKE IT OFFICIAL."
                      : "DENY THE ALLEGATIONS."}
                </h2>

                <p id="decision-description">
                  {pending.decision ===
                  "approve"
                      ? "Approve this incident and remove it from the pending queue?"
                      : "Reject this incident and remove it from the pending queue?"}
                  {" "}
                  The decision is permanent
                  under the current
                  one-review policy and
                  will be logged with your
                  verified moderator
                  identity.
                </p>

                <div
                    className={
                      styles.modalCase
                    }
                >
                            <span>
                                CASE /{" "}
                              {pending.incident.id
                                  .slice(0, 8)
                                  .toUpperCase()}
                            </span>

                  <p>
                    {
                      pending.incident
                          .story
                    }
                  </p>
                </div>

                {reviewErrorMessage && (
                    <div
                        className={
                          styles.modalError
                        }
                        role="alert"
                    >
                      {
                        reviewErrorMessage
                      }
                    </div>
                )}

                <div
                    className={
                      styles.modalActions
                    }
                >
                  <button
                      type="button"
                      className={
                        styles.cancelButton
                      }
                      ref={cancelRef}
                      disabled={
                        submitting
                      }
                      onClick={() => {
                        setPending(null);
                        setReviewErrorMessage(
                            ""
                        );
                      }}
                  >
                    CANCEL
                  </button>

                  <button
                      type="button"
                      className={
                        pending.decision ===
                        "approve"
                            ? styles.confirmApprove
                            : styles.confirmReject
                      }
                      disabled={
                        submitting
                      }
                      onClick={() =>
                          void confirmDecision()
                      }
                  >
                    {submitting
                        ? "TRANSMITTING..."
                        : pending.decision ===
                        "approve"
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
