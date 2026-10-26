
/**
 * Trauma Center moderator authentication.
 *
 * Uses Cloudflare Access's verified Worker context.
 * Never trusts user-supplied identity headers.
 */

export interface ModeratorIdentity {
	email: string;
}

interface AccessIdentity {
	email?: string;
}

interface VerifiedAccess {
	getIdentity(): Promise<AccessIdentity | null | undefined>;
}

export interface ModeratorContext {
	access?: VerifiedAccess | null;
}

export interface ModeratorConfig {
	MODERATOR_EMAILS?: string;
}

export type ModeratorAuthResult =
	| {
	authorized: true;
	moderator: ModeratorIdentity;
}
	| {
	authorized: false;
	reason: "UNAUTHENTICATED" | "FORBIDDEN";
};

/**
 * Check whether the request belongs to an
 * approved Trauma Center moderator.
 */
export async function authorizeModerator(
	context: ModeratorContext,
	env: ModeratorConfig
): Promise<ModeratorAuthResult> {
	if (!context.access) {
		return {
			authorized: false,
			reason: "UNAUTHENTICATED",
		};
	}

	let identity: AccessIdentity | null | undefined;

	try {
		identity = await context.access.getIdentity();
	} catch {
		return {
			authorized: false,
			reason: "UNAUTHENTICATED",
		};
	}

	const email = identity?.email?.trim().toLowerCase();

	if (!email) {
		return {
			authorized: false,
			reason: "UNAUTHENTICATED",
		};
	}

	const allowedEmails = new Set(
		(env.MODERATOR_EMAILS ?? "")
			.split(",")
			.map((value) => value.trim().toLowerCase())
			.filter(Boolean)
	);

	if (!allowedEmails.has(email)) {
		return {
			authorized: false,
			reason: "FORBIDDEN",
		};
	}

	return {
		authorized: true,
		moderator: {
			email,
		},
	};
}
