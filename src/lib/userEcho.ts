export type UserEchoMessage = {
  id: string;
  role: 'user';
  text: string;
  hasScreenshot: boolean;
  screenshotPreview?: string;
};

/**
 * What the chat shows as the user's own turn. A prompt the user typed is echoed. A
 * quick action sends a prompt the user never wrote, so its text is not shown; only an
 * attached screenshot is, because that is something the user chose.
 */
export function userEchoMessage(args: {
  id: string;
  promptText: string;
  echoPrompt: boolean;
  attachments: ReadonlyArray<{ preview: string }>;
}): UserEchoMessage | null {
  const hasScreenshot = args.attachments.length > 0;
  if (!args.echoPrompt && !hasScreenshot) return null;
  return {
    id: args.id,
    role: 'user',
    text: args.echoPrompt ? args.promptText : '',
    hasScreenshot,
    screenshotPreview: args.attachments[0]?.preview,
  };
}
