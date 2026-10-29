import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import NotesSettings from './NotesSettings';
import ImportedDocuments from './ImportedDocuments';
import AnswerSourcesSettings from './AnswerSourcesSettings';
import SearchIndexSettings from './SearchIndexSettings';

const quietButton = 'px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-component text-xs font-medium text-text-secondary hover:bg-bg-input hover:text-text-primary disabled:opacity-50';
const card = 'bg-bg-item-surface rounded-xl border border-border-subtle p-5 space-y-3';

const KnowledgeSettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [page, setPage] = useState('Sources');
    const [editingNotes, setEditingNotes] = useState(false);
    const queryClient = useQueryClient();
    const meetings = useQuery(['recent-meetings'], () => window.electronAPI.getRecentMeetings());
    const notes = useQuery(['profile-notes'], () => window.electronAPI.profileGetNotes());
    const profileStatus = useQuery(['profile', 'status'], () => window.electronAPI.profileGetStatus(), { staleTime: 30_000 });
    const notesIndex = profileStatus.data?.notesIndex;
    const removeNotes = useMutation(
        async () => {
            const result = await window.electronAPI.profileSetNotes('');
            if (!result.success) throw new Error(result.error || 'Could not remove notes');
        },
        {
            onSuccess: async () => {
                await Promise.all([
                    queryClient.invalidateQueries(['profile-notes']),
                    queryClient.invalidateQueries(['profile', 'status']),
                ]);
                setEditingNotes(false);
            },
        }
    );

    return (
        <div className="space-y-5 pb-10">
            <div className="space-y-1">
                <h3 className="text-sm font-bold text-text-primary">Knowledge</h3>
                <p className="text-xs text-text-secondary">Everything Pika can search for you: the meetings it records, and the materials you add.</p>
            </div>
            <div role="group" aria-label="Knowledge pages" className="inline-flex flex-wrap gap-1 rounded-lg border border-border-subtle p-1">
                {['Sources', 'Index'].map((label) => (
                    <button
                        key={label}
                        type="button"
                        aria-pressed={page === label}
                        onClick={() => setPage(label)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium ${page === label ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:bg-bg-input'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {page === 'Sources' && (
                <section className="space-y-3" aria-label="Sources">
                    <div className={card}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                                <h4 className="text-sm font-semibold text-text-primary">Recorded meetings, automatic</h4>
                                <p className="text-xs text-text-secondary">Each recorded meeting is queued for indexing when it ends.</p>
                                <p className="text-[11px] text-text-secondary" aria-live="polite">
                                    {meetings.error ? `✕ ${String(meetings.error instanceof Error ? meetings.error.message : meetings.error)}` : meetings.data ? `● ${meetings.data.length === 50 ? 'The latest ' : ''}${meetings.data.length} recorded meetings` : '● Loading meeting history…'}
                                </p>
                            </div>
                            <button type="button" onClick={onClose} className={quietButton}>Open meeting history</button>
                        </div>
                        <div className="border-t border-border-subtle pt-3 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0 flex-1 space-y-1">
                                    <h4 className="text-sm font-semibold text-text-primary">Notes</h4>
                                    <p className="text-[11px] text-text-secondary" aria-live="polite">
                                        {notes.error ? `✕ ${String(notes.error instanceof Error ? notes.error.message : notes.error)}` : notes.data !== undefined ? `${notes.data ? '● Saved' : '○ Empty'} · ${notes.data.length} characters` : '● Loading notes…'}
                                    </p>
                                    {notes.data && (
                                        <p className="text-xs text-text-primary break-words" aria-live="polite">
                                            {profileStatus.error ? `✕ ${String(profileStatus.error instanceof Error ? profileStatus.error.message : profileStatus.error)}`
                                                : profileStatus.isLoading ? '● Loading index status…'
                                                : notesIndex?.state === 'indexed' ? '✓ Indexed'
                                                : notesIndex?.state === 'not-indexed' ? '✕ Not indexed'
                                                : notesIndex?.state === 'needs-reindex' ? '▲ Needs re-index: the active embedding model differs'
                                                : '○ Unknown: index provenance was not recorded'}
                                            {notesIndex?.provider && ` · ${notesIndex.provider} · ${notesIndex.dimensions} dimensions`}
                                            {notesIndex?.state === 'indexed' && notesIndex.indexedAt && <> · <time dateTime={notesIndex.indexedAt}>{new Date(notesIndex.indexedAt).toLocaleString()}</time></>}
                                            {notesIndex?.error && ` · ${notesIndex.error}`}
                                        </p>
                                    )}
                                </div>
                                {notes.data && (
                                    <div className="flex flex-wrap gap-2">
                                        <button type="button" aria-expanded={editingNotes} onClick={() => setEditingNotes(!editingNotes)} className={quietButton}>Edit</button>
                                        <button
                                            type="button"
                                            disabled={removeNotes.isLoading}
                                            onClick={() => {
                                                if (confirm('Remove your saved notes?')) removeNotes.mutate();
                                            }}
                                            className={quietButton}
                                        >
                                            {removeNotes.isLoading ? 'Removing…' : 'Remove'}
                                        </button>
                                    </div>
                                )}
                            </div>
                            {notes.data === '' && !editingNotes && (
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-xs text-text-secondary">Add a note for Pika to search.</p>
                                    <button type="button" onClick={() => setEditingNotes(true)} className="px-3 py-1.5 rounded-lg bg-accent-primary text-on-primary text-xs font-medium">Write a note</button>
                                </div>
                            )}
                            {removeNotes.error ? <p role="alert" className="text-xs text-text-primary">✕ {String(removeNotes.error instanceof Error ? removeNotes.error.message : removeNotes.error)}</p> : null}
                            <ImportedDocuments />
                        </div>
                    </div>
                    {editingNotes && <NotesSettings />}
                    <AnswerSourcesSettings />
                </section>
            )}

            {page === 'Index' && <SearchIndexSettings />}
        </div>
    );
};

export default KnowledgeSettings;
