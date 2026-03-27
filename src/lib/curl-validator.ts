import curl2Json from "@bany/curl-to-json";

export interface CurlValidationResult {
    isValid: boolean;
    message?: string;
    json?: any;
}

export const validateCurl = (curl: string): CurlValidationResult => {
    if (!curl || !curl.trim()) {
        return { isValid: false, message: "Command cannot be empty." };
    }

    // Basic check for curl command
    if (!curl.trim().toLowerCase().startsWith("curl")) {
        return {
            isValid: false,
            message: "The command must start with 'curl'.",
        };
    }

    try {
        const json = curl2Json(curl);

        // Check for {{TEXT}} placeholder
        if (!curl.includes("{{TEXT}}")) {
            return {
                isValid: false,
                message: "Your cURL must contain {{TEXT}} variable to inject the user message."
            };
        }

        return { isValid: true, json };
    } catch (error) {
        return {
            isValid: false,
            message:
                "Invalid cURL command syntax. Please check for typos.",
        };
    }
};
