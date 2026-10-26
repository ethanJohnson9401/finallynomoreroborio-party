
export const MIN_STORY_LENGTH = 20;
export const MAX_STORY_LENGTH = 1000;

export type IncidentValidationResult =
	| {
	valid: true;
	story: string;
}
	| {
	valid: false;
	error: string;
};

export function validateIncident(
	body: unknown
): IncidentValidationResult {
	if (
		typeof body !== "object" ||
		body === null ||
		Array.isArray(body) ||
		!("story" in body) ||
		typeof body.story !== "string"
	) {
		return {
			valid: false,
			error: "INVALID_STORY",
		};
	}

	const story = body.story.trim();

	if (
		story.length < MIN_STORY_LENGTH ||
		story.length > MAX_STORY_LENGTH
	) {
		return {
			valid: false,
			error: "INVALID_STORY_LENGTH",
		};
	}

	return {
		valid: true,
		story,
	};
}
