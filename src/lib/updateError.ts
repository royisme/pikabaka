// electron-updater reports a failure as one long string (a Chromium error code, an HTTP status, a stack).
// The reader gets a sentence that says what to do; the first line of the real message stays next to it
// (the full text is the tooltip), so a failure never hides its cause.
const CAUSES: Array<[RegExp, string]> = [
    [/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT/,
        'No connection. Check your network and try again.'],
    [/Cannot find .*\.yml|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|ERR_UPDATER_(RELEASE|LATEST_VERSION)_NOT_FOUND|ERR_UPDATER_NO_PUBLISHED_VERSIONS|HttpError: 404/,
        'This release has no update files yet. Try again in a few minutes.'],
    [/HttpError: (403|429)|rate limit/i,
        'GitHub is limiting requests. Try again later.'],
    [/HttpError: 5\d\d/,
        'GitHub is having problems. Try again later.'],
    [/ERR_UPDATER_INVALID_SIGNATURE|checksum|sha512|code signature/i,
        'The downloaded update failed verification and was not installed.'],
    [/ENOSPC/,
        'Not enough disk space to download the update.'],
];

export function describeUpdateError(raw: string): { summary: string; detail: string } {
    const summary = CAUSES.find(([pattern]) => pattern.test(raw))?.[1] ?? 'The update could not be completed.';
    const detail = raw.split('\n').find((line) => line.trim() !== '')?.trim() ?? raw.trim();
    return { summary, detail };
}
