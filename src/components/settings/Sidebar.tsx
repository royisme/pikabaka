import React, { useCallback, useRef } from 'react';
import { Monitor, Cpu, Info } from 'lucide-react';

interface SidebarProps {
    activeTab: 'general' | 'ai-providers' | 'about';
    setActiveTab: (tab: 'general' | 'ai-providers' | 'about') => void;
    onClose: () => void;
}

const tabs = [
    { id: 'general' as const, label: 'General', icon: Monitor },
    { id: 'ai-providers' as const, label: 'AI Providers', icon: Cpu },
    { id: 'about' as const, label: 'About', icon: Info },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, onClose }) => {
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

    const focusAndActivateTab = useCallback((index: number) => {
        const tab = tabs[index];
        if (!tab) return;
        setActiveTab(tab.id);
        tabRefs.current[index]?.focus();
    }, [setActiveTab]);

    const handleTabListKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
        const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
        if (currentIndex === -1) return;

        switch (event.key) {
            case 'ArrowUp':
                event.preventDefault();
                focusAndActivateTab((currentIndex - 1 + tabs.length) % tabs.length);
                break;
            case 'ArrowDown':
                event.preventDefault();
                focusAndActivateTab((currentIndex + 1) % tabs.length);
                break;
            case 'Home':
                event.preventDefault();
                focusAndActivateTab(0);
                break;
            case 'End':
                event.preventDefault();
                focusAndActivateTab(tabs.length - 1);
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                setActiveTab(activeTab);
                break;
            default:
                break;
        }
    }, [activeTab, focusAndActivateTab, setActiveTab]);

    return (
        <div className="w-64 bg-bg-sidebar flex flex-col border-r border-border-subtle h-full">
            <div className="p-6">
                <h2 className="font-semibold text-gray-400 text-xs uppercase tracking-wider mb-4">Advanced Settings</h2>
                <nav
                    className="space-y-1"
                    role="tablist"
                    aria-label="Settings sections"
                    aria-orientation="vertical"
                    onKeyDown={handleTabListKeyDown}
                >
                    <button
                        ref={(element) => { tabRefs.current[0] = element; }}
                        id="settings-tab-general"
                        role="tab"
                        aria-selected={activeTab === 'general'}
                        tabIndex={activeTab === 'general' ? 0 : -1}
                        onClick={() => setActiveTab('general')}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'general' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                    >
                        <Monitor size={16} /> General
                    </button>
                    <button
                        ref={(element) => { tabRefs.current[1] = element; }}
                        id="settings-tab-ai-providers"
                        role="tab"
                        aria-selected={activeTab === 'ai-providers'}
                        tabIndex={activeTab === 'ai-providers' ? 0 : -1}
                        onClick={() => setActiveTab('ai-providers')}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'ai-providers' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                    >
                        <Cpu size={16} /> AI Providers
                    </button>
                    <button
                        ref={(element) => { tabRefs.current[2] = element; }}
                        id="settings-tab-about"
                        role="tab"
                        aria-selected={activeTab === 'about'}
                        tabIndex={activeTab === 'about' ? 0 : -1}
                        onClick={() => setActiveTab('about')}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'about' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                    >
                        <Info size={16} /> About
                    </button>
                </nav>
            </div>

            <div className="mt-auto p-6 border-t border-border-subtle">
                <button
                    onClick={onClose}
                    aria-label="Close settings"
                    className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50 transition-colors flex items-center gap-3"
                >
                    Close
                </button>
            </div>
        </div>
    );
};
