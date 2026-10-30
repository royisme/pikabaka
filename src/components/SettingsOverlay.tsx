import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, FlaskConical, Info, Keyboard, Mic, Monitor, Settings, X } from 'lucide-react';
import { AboutSection } from './AboutSection';
import { AIProvidersSettings } from './settings/AIProvidersSettings';
import KnowledgeSettings from './settings/KnowledgeSettings';
import ProviderSetupSettings from './settings/ProviderSetupSettings';
import { ProviderNavigation } from './settings/ConnectionModelPicker';
import { useGeneralSettings, renderGeneralSettings } from './settings/GeneralSettings';
import { useAudioSettings, renderAudioSettings } from './settings/AudioSettings';
import { useShortcutsSettings, renderShortcutsSettings } from './settings/ShortcutsSettings';

interface SettingsOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: string;
}

const SettingsOverlay: React.FC<SettingsOverlayProps> = ({ isOpen, onClose, initialTab = 'general' }) => {
    const initialProviderId = initialTab.startsWith('providers:') ? initialTab.slice('providers:'.length) : undefined;
    const initialSection = initialProviderId ? 'providers' : initialTab;
    const [activeTab, setActiveTab] = useState(initialSection);
    const [providerEditorId, setProviderEditorId] = useState(initialProviderId);
    // Sync active tab when modal opens or initialTab prop changes
    const [prevOpenState, setPrevOpenState] = useState({ isOpen, initialTab });
    if (isOpen && (!prevOpenState.isOpen || initialTab !== prevOpenState.initialTab)) {
        setPrevOpenState({ isOpen, initialTab });
        setActiveTab(initialSection);
        setProviderEditorId(initialProviderId);
    } else if (!isOpen && prevOpenState.isOpen) {
        setPrevOpenState({ isOpen, initialTab });
    }

    // Each tab owns its own state and handlers; they run here, unconditionally, so the tab a visit
    // starts on does not change what is held or when it loads.
    const general = useGeneralSettings(isOpen);
    const audio = useAudioSettings({ isOpen, isActive: activeTab === 'audio' });
    const shortcuts = useShortcutsSettings();

    return (
        <ProviderNavigation.Provider value={{ editorId: providerEditorId, open: (id) => { setProviderEditorId(id); setActiveTab('providers'); } }}>
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-50 flex items-center justify-center p-8 transition-colors duration-150 bg-black/60 backdrop-blur-sm"
                >
                    <motion.div
                        id="settings-panel-wrapper"
                        initial={{ scale: 0.94, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.94, opacity: 0, y: 20 }}
                        transition={{ 
                            type: "spring", 
                            stiffness: 400, 
                            damping: 32,
                            mass: 1
                        }}
                        className="bg-bg-elevated w-full max-w-4xl h-[80vh] rounded-2xl border border-border-subtle shadow-2xl overflow-hidden relative"
                    >
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close settings"
                            className="absolute top-4 right-4 z-10 p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-item-active/60 transition-colors"
                        >
                            <X size={16} strokeWidth={2.25} />
                        </button>
                        <div
                            className="flex w-full h-full"
                        >
                        {/* Sidebar */}
                        <div className="w-64 bg-bg-sidebar flex flex-col border-r border-border-subtle">
                            <div className="p-6">
                                <h2 className="font-semibold text-text-tertiary text-xs uppercase tracking-wider mb-2">Settings</h2>
                                <nav className="space-y-1">
                                    <button
                                        onClick={() => setActiveTab('general')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'general' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Monitor size={16} /> General
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('audio')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'audio' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Mic size={16} className="shrink-0" /> Audio &amp; Translation
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('ai-providers')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'ai-providers' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <FlaskConical size={16} /> Models &amp; Agent
                                    </button>
                                    <button
                                        onClick={() => { setProviderEditorId(undefined); setActiveTab('providers'); }}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'providers' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Settings size={16} /> Provider setup
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('keybinds')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'keybinds' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Keyboard size={16} /> Shortcuts
                                    </button>
                                    <button
                                        onClick={() => {
                                            setActiveTab('profile');
                                        }}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'profile' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <BookOpen size={16} /> Knowledge
                                    </button>

                                    <button
                                        onClick={() => setActiveTab('about')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'about' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Info size={16} /> About
                                    </button>
                                </nav>
                            </div>

                            <div className="mt-auto px-6 py-4 border-t border-border-subtle">
                                <button
                                    type="button"
                                    onClick={() => window.electronAPI.quitApp()}
                                    className="text-xs font-medium text-text-tertiary hover:text-state-danger transition-colors"
                                >
                                    Quit Pika
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto bg-bg-main p-8">
                            {activeTab === 'general' && renderGeneralSettings(general)}
                            {activeTab === 'profile' && (
                                <KnowledgeSettings onClose={onClose} />
                            )}
                            {activeTab === 'ai-providers' && (
                                <AIProvidersSettings onOpenProviders={() => { setProviderEditorId(undefined); setActiveTab('providers'); }} />
                            )}
                            {activeTab === 'providers' && (
                                <ProviderSetupSettings key={providerEditorId ?? 'list'} onOpenModels={() => setActiveTab('ai-providers')} />
                            )}
                            {activeTab === 'keybinds' && renderShortcutsSettings(shortcuts)}
                            {activeTab === 'audio' && renderAudioSettings(audio, () => { setProviderEditorId(undefined); setActiveTab('providers'); })}
                            {activeTab === 'about' && (
                                <AboutSection />
                            )}
                        </div>
                    </div>
                    </motion.div>
                </motion.div>
            )
            }
        </AnimatePresence >
        </ProviderNavigation.Provider>
    );
};

export default SettingsOverlay;
