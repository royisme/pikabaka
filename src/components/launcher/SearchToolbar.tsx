import React from 'react';
import { Search } from 'lucide-react';

export type TimeFilter = 'all' | 'today' | 'week' | 'month';

interface SearchToolbarProps {
    query: string;
    onQueryChange: (query: string) => void;
    filter: TimeFilter;
    onFilterChange: (filter: TimeFilter) => void;
}

const FILTERS: Array<{ value: TimeFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
];

const SearchToolbar: React.FC<SearchToolbarProps> = ({ query, onQueryChange, filter, onFilterChange }) => {
    return (
        <div className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-bg-elevated/70 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <label className="relative flex min-w-0 flex-1 items-center">
                <Search size={16} className="pointer-events-none absolute left-3 text-text-tertiary" />
                <input
                    type="search"
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="Search meetings, summaries, transcripts..."
                    className="h-10 w-full rounded-xl border border-border-subtle bg-bg-input py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-tertiary outline-none transition-colors hover:bg-bg-elevated focus:border-accent-primary/50 focus:ring-2 focus:ring-accent-primary/20"
                />
            </label>
            <div className="flex flex-wrap items-center gap-2" aria-label="Meeting time range filters">
                {FILTERS.map((item) => {
                    const selected = filter === item.value;
                    return (
                        <button
                            key={item.value}
                            type="button"
                            onClick={() => onFilterChange(item.value)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent-primary/30 ${selected
                                ? 'border-accent-primary/30 bg-accent-primary/15 text-accent-primary'
                                : 'border-border-subtle bg-bg-input text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}
                            aria-pressed={selected}
                        >
                            {item.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default SearchToolbar;
