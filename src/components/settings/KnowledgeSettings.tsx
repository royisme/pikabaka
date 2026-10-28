import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useProfileStatus } from '../../hooks/useProfileStatus';
import { useProfileData } from '../../hooks/useProfileData';
import { useUploadResume } from '../../hooks/useUploadResume';
import { useKnowledgeMode } from '../../hooks/useKnowledgeMode';
import { ProfileVisualizer } from '../knowledge/ProfileVisualizer';
import { JDListManager } from '../knowledge/JDListManager';
import NotesSettings from './NotesSettings';
import AnswerSourcesSettings from './AnswerSourcesSettings';
import SearchIndexSettings from './SearchIndexSettings';

const quietButton = 'px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-component text-xs font-medium text-text-secondary hover:bg-bg-input hover:text-text-primary disabled:opacity-50';
const card = 'bg-bg-item-surface rounded-xl border border-border-subtle p-5 space-y-3';

const KnowledgeSettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [page, setPage] = useState('Sources');
    const [editingNotes, setEditingNotes] = useState(false);
    const [fileError, setFileError] = useState('');
    const queryClient = useQueryClient();
    const meetings = useQuery(['recent-meetings'], () => window.electronAPI.getRecentMeetings());
    const notes = useQuery(['profile-notes'], () => window.electronAPI.profileGetNotes());
    const profileStatus = useProfileStatus();
    const notesIndex = profileStatus.data?.notesIndex;
    const profile = useProfileData(page === 'Interview profile');
    const profileData = profile.data;
    const hasProfile = profileStatus.data?.hasProfile;
    const uploadResume = useUploadResume();
    const { isEnabled: knowledgeMode, toggle: toggleKnowledge } = useKnowledgeMode();
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
    const deleteProfile = useMutation(
        async () => {
            const result = await window.electronAPI.profileDelete();
            if (!result.success) throw new Error(result.error || 'Could not delete profile');
        },
        { onSuccess: () => queryClient.invalidateQueries(['profile']) }
    );
    const profileError = uploadResume.error || deleteProfile.error || toggleKnowledge.error || profile.error || profileStatus.error;

    return (
        <div className="space-y-5 pb-10">
            <div className="space-y-1">
                <h3 className="text-sm font-bold text-text-primary">Knowledge</h3>
                <p className="text-xs text-text-secondary">Everything Pika can search for you: the meetings it records, and the materials you add. Interview practice is optional and has its own page.</p>
            </div>
            <div role="group" aria-label="Knowledge pages" className="inline-flex flex-wrap gap-1 rounded-lg border border-border-subtle p-1">
                {['Sources', 'Index', 'Interview profile'].map((label) => (
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
                        </div>
                    </div>
                    {editingNotes && <NotesSettings />}
                    <AnswerSourcesSettings />
                </section>
            )}

            {page === 'Index' && <SearchIndexSettings />}

            {page === 'Interview profile' && (
                <section className="space-y-5" aria-label="Interview profile">
                    <p className="text-xs text-text-secondary">Only for interview practice. Everyday meetings never need it.</p>
                    <div className={card}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                                <h4 className="text-sm font-semibold text-text-primary">Resume</h4>
                                <p className="text-xs text-text-secondary break-words">
                                    {hasProfile ? profileData?.identity?.name || 'Resume added.' : profileStatus.isLoading ? 'Loading resume status…' : 'No resume added.'}
                                </p>
                                {profileData?.identity?.email && <p className="text-xs text-text-secondary break-words">{profileData.identity.email}</p>}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {hasProfile && (
                                    <button
                                        type="button"
                                        disabled={deleteProfile.isLoading || uploadResume.isLoading}
                                        onClick={() => {
                                            if (confirm('Are you sure you want to delete your resume? This will clear your profile data.')) deleteProfile.mutate();
                                        }}
                                        className={quietButton}
                                    >
                                        {deleteProfile.isLoading ? 'Deleting…' : 'Delete Profile'}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={async () => {
                                        setFileError('');
                                        try {
                                            const result = await window.electronAPI.profileSelectFile();
                                            if (result.error) throw new Error(result.error);
                                            if (result.filePath) uploadResume.mutate(result.filePath);
                                        } catch (error) {
                                            setFileError(error instanceof Error ? error.message : String(error));
                                        }
                                    }}
                                    disabled={uploadResume.isLoading || deleteProfile.isLoading || profileStatus.isLoading}
                                    className="px-3 py-1.5 rounded-lg bg-accent-primary text-on-primary text-xs font-medium disabled:opacity-50"
                                >
                                    {uploadResume.isLoading ? 'Uploading…' : hasProfile ? 'Refresh resume' : 'Add resume'}
                                </button>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs text-text-secondary">Use your background in suggestions</span>
                            <button
                                type="button"
                                role="switch"
                                aria-label="Use your background in suggestions"
                                aria-checked={knowledgeMode}
                                disabled={!hasProfile || toggleKnowledge.isLoading}
                                onClick={() => toggleKnowledge.mutate(!knowledgeMode)}
                                className={quietButton}
                            >
                                {toggleKnowledge.isLoading ? 'Updating…' : knowledgeMode ? '● On' : '○ Off'}
                            </button>
                        </div>
                        {profileData && (
                            <>
                                <dl className="flex flex-wrap gap-5 text-xs text-text-secondary">
                                    <div><dt>Experience</dt><dd className="text-sm font-semibold text-text-primary">{profileData.experienceCount ?? 'Unknown'}</dd></div>
                                    <div><dt>Projects</dt><dd className="text-sm font-semibold text-text-primary">{profileData.projectCount ?? 'Unknown'}</dd></div>
                                    <div><dt>Profile Summary</dt><dd className="text-sm font-semibold text-text-primary">{profileData.nodeCount ?? 'Unknown'}</dd></div>
                                </dl>
                                {profileData.skills.length > 0 && (
                                    <div className="space-y-2">
                                        <h4 className="text-[11px] font-semibold text-text-primary">Core Skills</h4>
                                        <div className="flex flex-wrap gap-1.5">
                                            {profileData.skills.slice(0, 15).map((skill, index) => <span key={index} className="text-[11px] text-text-secondary px-2 py-1 rounded-md border border-border-subtle">{skill}</span>)}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                        {fileError || profileError ? <p role="alert" className="text-xs text-text-primary">✕ {fileError || String(profileError instanceof Error ? profileError.message : profileError)}</p> : null}
                    </div>
                    <JDListManager onSelectFile={() => window.electronAPI.profileSelectFile()} />
                    <ProfileVisualizer profileData={profileData} />
                </section>
            )}
        </div>
    );
};

export default KnowledgeSettings;
