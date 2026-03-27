import curl2Json from "@bany/curl-to-json";

export interface CurlValidationResult {
    isValid: boolean;
    message?: string;
    json?: any;
}

/**
 * Validates if the cURL command is parseable and contains required variables
 */
export const validateCurl = (curl: string): CurlValidationResult => {
    if (!curl || !curl.trim()) {
        return { isValid: false, message: "Command cannot be empty." };
    }

    if (!curl.trim().toLowerCase().startsWith("curl")) {
        return { isValid: false, message: "Command must start with 'curl'." };
    }

    try {
        const json = curl2Json(curl);

        // Ensure {{TEXT}} is present so we can inject the prompt
        // We check the raw string for the placeholder because it might be in url, header, or body
        if (!curl.includes("{{TEXT}}")) {
            return {
                isValid: false,
                message: "Your cURL must contain {{TEXT}} placeholder for the prompt."
            };
        }

        return { isValid: true, json };
    } catch (error) {
        return { isValid: false, message: "Invalid cURL syntax." };
    }
};

/**
 * Replaces {{KEY}} placeholders with actual values
 */
export function deepVariableReplacer(
    node: any,
    variables: Record<string, string>
): any {
    if (typeof node === "string") {
        let result = node;
        for (const [key, value] of Object.entries(variables)) {
            // Global replace of {{KEY}}
            result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
        }
        return result;
    }
    if (Array.isArray(node)) {
        return node.map((item) => deepVariableReplacer(item, variables));
    }
    if (node && typeof node === "object") {
        const newNode: { [key: string]: any } = {};
        for (const key in node) {
            newNode[key] = deepVariableReplacer(node[key], variables);
        }
        return newNode;
    }
    return node;
}

/**
 * Detects MIME type from a file path's extension.
 * Defaults to "image/png" because the app's ScreenshotHelper exclusively produces .png files.
 */
export function imageMimeTypeFromPath(filePath: string): string {
    // Extract only the final extension component, guarding against paths with no dot
    const basename = filePath.split(/[/\\]/).pop() ?? "";
    const dotIdx = basename.lastIndexOf(".");
    const ext = dotIdx !== -1 ? basename.slice(dotIdx + 1).toLowerCase() : "";
    const map: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
    };
    return map[ext] ?? "image/png";
}

/**
 * Auto-upgrades the last user message in an OpenAI-compatible `messages` array
 * from a plain string to a multimodal content array when a base64 image is present.
 *
 * - If `body.messages` is not an array, returns `body` unchanged (no-op for non-OpenAI formats).
 * - If the last user message already contains an image_url part, it is not duplicated.
 * - If the content is already a multimodal array (e.g. user manually included {{IMAGE_BASE64}}
 *   in an image_url field), the image is appended only if not already present.
 * - All other messages and body fields are left untouched (fully backward-compatible).
 */
export function injectImageIntoMessages(
    body: any,
    base64Image: string,
    imagePath: string
): any {
    if (!base64Image || !Array.isArray(body?.messages)) return body;

    const messages: any[] = body.messages.slice();

    // Find the last user-role message
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === "user") {
            lastUserIdx = i;
            break;
        }
    }
    if (lastUserIdx === -1) return body;

    const lastUser = messages[lastUserIdx];
    const mimeType = imageMimeTypeFromPath(imagePath);
    const imageUrl = `data:${mimeType};base64,${base64Image}`;

    if (Array.isArray(lastUser.content)) {
        // Already a multimodal array — append image_url only if absent
        const alreadyHasImage = lastUser.content.some(
            (part: any) => part?.type === "image_url"
        );
        if (alreadyHasImage) return body;
        messages[lastUserIdx] = {
            ...lastUser,
            content: [
                ...lastUser.content,
                { type: "image_url", image_url: { url: imageUrl } },
            ],
        };
    } else if (typeof lastUser.content === "string") {
        // Plain string → standard OpenAI multimodal array
        messages[lastUserIdx] = {
            ...lastUser,
            content: [
                { type: "text", text: lastUser.content },
                { type: "image_url", image_url: { url: imageUrl } },
            ],
        };
    }
    // Non-string, non-array content (e.g. null/undefined): leave untouched

    return { ...body, messages };
}

/**
 * Helper to traverse a JSON object via dot notation (e.g. "choices[0].message.content")
 */
export function getByPath(obj: any, path: string): any {
    if (!path) return obj;
    return path
        .replace(/\[/g, ".")
        .replace(/\]/g, "")
        .split(".")
        .reduce((o, k) => (o || {})[k], obj);
}
