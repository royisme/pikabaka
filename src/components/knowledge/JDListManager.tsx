import React, { useState } from 'react';
import { Briefcase, Check, Trash2, Plus, Upload } from 'lucide-react';
import { useJDList, useActivateJD, useDeleteJD, useUploadNewJD } from '../../hooks/useJDList';
import type { JDListItem } from '../../../electron/knowledge/types';
import { InterviewPrepPanel } from './InterviewPrepPanel';

interface JDListManagerProps {
  onSelectFile: () => Promise<{ success?: boolean; cancelled?: boolean; filePath?: string; error?: string }>;
}

export const JDListManager: React.FC<JDListManagerProps> = ({ onSelectFile }) => {
  const { data: jds = [], isLoading, error } = useJDList();
  const activateJD = useActivateJD();
  const deleteJD = useDeleteJD();
  const uploadJD = useUploadNewJD();
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [prepJD, setPrepJD] = useState<{ id: number; title: string; company: string } | null>(null);

  const handleUpload = async () => {
    try {
      setIsUploading(true);
      setFileError('');
      const fileResult = await onSelectFile();
      if (fileResult.error) throw new Error(fileResult.error);
      if (fileResult?.filePath) {
        await uploadJD.mutateAsync(fileResult.filePath);
      }
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteJD.mutateAsync(id);
      setDeleteConfirmId(null);
    } catch (e) {
      console.error('JD delete failed:', e);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5">
        <p className="text-xs text-text-secondary">● Loading roles…</p>
      </div>
    );
  }

  const failure = fileError || uploadJD.error || deleteJD.error || activateJD.error || error;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-text-primary">Roles You're Targeting</h4>
          <p className="text-xs text-text-secondary mt-0.5">Keep the opportunities you're preparing for together in one place.</p>
        </div>
        <button
          onClick={handleUpload}
          disabled={isUploading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle text-xs font-medium text-text-primary hover:bg-bg-input disabled:opacity-50"
        >
          {isUploading ? (
            <>Adding role…</>
          ) : (
            <><Plus size={12} /> Add Role</>
          )}
        </button>
      </div>

      {failure ? <p role="alert" className="text-xs text-text-primary">✕ {String(failure instanceof Error ? failure.message : failure)}</p> : null}

      {error ? null : jds.length === 0 ? (
        <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-8 text-center">
          <Briefcase size={24} className="mx-auto text-text-tertiary mb-3" />
          <p className="text-sm font-medium text-text-secondary">No roles added yet</p>
          <p className="text-xs text-text-tertiary mt-1">Add a job description to make prep more focused and tailored.</p>
          <button
            onClick={handleUpload}
            disabled={isUploading}
            className="mt-4 px-4 py-2 rounded-lg border border-border-subtle text-xs font-medium text-text-primary hover:bg-bg-input disabled:opacity-50"
          >
            <Upload size={12} className="inline mr-1.5" />
            Upload Job Description
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {jds.map((jd: JDListItem) => (
            <div
              key={jd.id}
              className={`bg-bg-item-surface rounded-xl border transition-all group ${
                jd.isActive
                  ? 'border-accent-primary/50 ring-1 ring-accent-primary/20'
                  : 'border-border-subtle hover:border-border-muted'
              }`}
            >
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    jd.isActive
                      ? 'bg-accent-primary/10 text-accent-primary'
                      : 'bg-bg-input border border-border-subtle text-text-tertiary'
                  }`}>
                    {jd.isActive ? <Check size={14} /> : <Briefcase size={14} />}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-pressed={jd.isActive}
                        onClick={() => { if (!jd.isActive) activateJD.mutate(jd.id); }}
                        className="text-sm font-semibold text-text-primary truncate text-left"
                      >
                        {jd.title}
                      </button>
                      {jd.isActive && (
                        <span className="text-[11px] font-bold text-text-secondary px-1.5 py-0.5 rounded uppercase tracking-wide border border-border-subtle shrink-0">
                          ✓ Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5">{jd.company}</p>

                    {jd.technologies.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {jd.technologies.slice(0, 5).map((tech, i) => (
                          <span key={i} className="text-[11px] font-medium text-text-secondary px-1.5 py-0.5 rounded border border-border-subtle bg-bg-input">
                            {tech}
                          </span>
                        ))}
                        {jd.technologies.length > 5 && (
                          <span className="text-[11px] text-text-tertiary">+{jd.technologies.length - 5}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {jd.isActive && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPrepJD({ id: jd.id, title: jd.title, company: jd.company });
                      }}
                      className="text-[11px] font-medium text-accent-primary hover:bg-accent-primary/10 px-2 py-1 rounded-md transition-colors"
                    >
                      View Prep
                    </button>
                  )}
                  {deleteConfirmId === jd.id ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDelete(jd.id)}
                        className="text-[11px] font-medium text-state-danger hover:bg-state-danger-soft px-2 py-1 rounded-md transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="text-[11px] font-medium text-text-tertiary hover:text-text-secondary px-2 py-1 rounded-md transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(jd.id);
                      }}
                      aria-label={`Delete ${jd.title}`}
                      className="text-text-tertiary hover:text-state-danger p-1.5 rounded-md hover:bg-state-danger-soft transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {prepJD && (
        <InterviewPrepPanel
          isOpen={!!prepJD}
          onClose={() => setPrepJD(null)}
          jdId={prepJD.id}
          jdTitle={prepJD.title}
          jdCompany={prepJD.company}
        />
      )}
    </div>
  );
};
