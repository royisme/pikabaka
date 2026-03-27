
export type EnglishVariant = {
    label: string;
    primary: string;
    alternates: string[];
};

export const ENGLISH_VARIANTS: Record<string, EnglishVariant> = {
    'english-india': {
        label: 'English (India)',
        primary: 'en-IN',
        alternates: ['en-US', 'en-GB', 'en-AU', 'en-CA'],
    },
    'english-us': {
        label: 'English (United States)',
        primary: 'en-US',
        alternates: ['en-IN', 'en-GB', 'en-AU', 'en-CA'],
    },
    'english-uk': {
        label: 'English (United Kingdom)',
        primary: 'en-GB',
        alternates: ['en-IN', 'en-US', 'en-AU', 'en-CA'],
    },
    'english-au': {
        label: 'English (Australia)',
        primary: 'en-AU',
        alternates: ['en-GB', 'en-US', 'en-IN', 'en-CA'],
    },
    'english-ca': {
        label: 'English (Canada)',
        primary: 'en-CA',
        alternates: ['en-US', 'en-GB', 'en-IN', 'en-AU'],
    },
};
