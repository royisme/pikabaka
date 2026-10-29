import React from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import type { DocumentIndexState, ImportedDocument } from '../../../electron/knowledge/types';

const quietButton = 'px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-component text-xs font-medium text-text-secondary hover:bg-bg-input hover:text-text-primary disabled:opacity-50';

const KIND_LABEL: Record<ImportedDocument['kind'], string> = { txt: 'Text', md: 'Markdown', docx: 'Word document' };

const importedDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** The state in words plus a mark, from the reply. A failure shows only the first line of the real error. */
function stateWords(doc: ImportedDocument): string {
    const reason = doc.error?.split('\n')[0] ?? '';
    const words: Record<DocumentIndexState, string> = {
        indexing: `● Indexing ${doc.passages} passages`,
        indexed: `✓ Indexed · ${doc.provider} · ${doc.dimensions} dimensions · ${doc.indexedAt ? new Date(doc.indexedAt).toLocaleString() : ''}`,
        'needs-reindex': '▲ Needs re-index: the search model changed. Not searched until re-indexed.',
        failed: doc.provider ? `▲ Re-index failed: ${reason}. Still searched with the index from ${doc.indexedAt ? new Date(doc.indexedAt).toLocaleString() : ''}.` : `✕ Not indexed: ${reason}`,
        'not-indexed': '○ Not indexed: indexing stopped before it finished.',
    };
    return words[doc.state];
}

/**
 * The Documents block under Notes on the Sources page. The main process opens the import dialog, so this
 * component never sends a path; the list refetches every 2 s only while a row is indexing.
 */
const ImportedDocuments: React.FC = () => {
    const queryClient = useQueryClient();
    const documents = useQuery(['knowledge-documents'], async () => {
        const result = await window.electronAPI.knowledgeListDocuments();
        if (!result.success) throw new Error(result.error);
        return result.documents;
    }, {
        refetchInterval: (rows?: ImportedDocument[]) => rows?.some(doc => doc.state === 'indexing') ? 2000 : false,
    });
    const sources = useQuery(['answer-sources'], () => window.electronAPI.getAnswerSources());
    const refetch = () => queryClient.invalidateQueries(['knowledge-documents']);
    const importDocument = useMutation(async () => {
        const result = await window.electronAPI.knowledgeImportDocument();
        if ('cancelled' in result) return result;
        if (!result.success) throw new Error(result.error);
        await refetch();
        return result;
    });
    const remove = useMutation(async (id: number) => {
        const result = await window.electronAPI.knowledgeRemoveDocument(id);
        if (!result.success) throw new Error(result.error || 'Could not remove the document');
        await refetch();
    });
    const reindex = useMutation(async (id: number) => {
        const result = await window.electronAPI.knowledgeReindexDocument(id);
        if (!result.success) throw new Error(result.error || 'Could not re-index the document');
        await refetch();
    });
    const rows = documents.data;
    const message = (error: unknown) => error instanceof Error ? error.message : error ? String(error) : '';
    const queryError = message(documents.error);
    const docx = globalThis.window?.electronAPI?.platform === 'darwin';
    return (
        <div className="border-t border-border-subtle pt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-text-primary">Documents</h4>
                <button type="button" disabled={importDocument.isLoading} onClick={() => { importDocument.reset(); importDocument.mutate(); }} className={quietButton}>
                    {importDocument.isLoading ? 'Importing…' : 'Import a document'}
                </button>
            </div>
            {message(importDocument.error) ? <p role="alert" className="text-xs text-text-primary">✕ {message(importDocument.error)}</p> : null}
            {rows && rows.length > 0 && sources.data?.materials === false && (
                <p className="text-xs text-text-secondary">Not used when answering: Materials is off under Use when answering.</p>
            )}
            {queryError ? <p role="alert" className="text-xs text-text-primary">✕ {queryError}</p>
                : documents.isLoading ? <p className="text-xs text-text-secondary">● Loading documents…</p>
                : rows && rows.length === 0 ? <p className="text-xs text-text-secondary">No documents yet. Import a .txt{docx ? ', .md or .docx' : ' or .md'} file for Pika to search.</p>
                : null}
            {rows?.map(doc => (
                <div key={doc.id} className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-xs text-text-primary break-words">{doc.name}</p>
                        <p className="text-[11px] text-text-secondary">{KIND_LABEL[doc.kind]} · {importedDate(doc.importedAt)} · {doc.passages} passages</p>
                        <p className="text-xs text-text-primary break-words">{stateWords(doc)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {(doc.state === 'needs-reindex' || doc.state === 'failed' || doc.state === 'not-indexed') && (
                            <button type="button" disabled={reindex.isLoading} onClick={() => { reindex.reset(); reindex.mutate(doc.id); }} className={quietButton}>
                                {reindex.isLoading ? 'Re-indexing…' : 'Re-index'}
                            </button>
                        )}
                        <button
                            type="button"
                            disabled={remove.isLoading}
                            onClick={() => { if (confirm(`Remove ${doc.name}?`)) { remove.reset(); remove.mutate(doc.id); } }}
                            className={quietButton}
                        >
                            {remove.isLoading ? 'Removing…' : 'Remove'}
                        </button>
                    </div>
                </div>
            ))}
            {message(remove.error) || message(reindex.error) ? <p role="alert" className="text-xs text-text-primary">✕ {message(remove.error) || message(reindex.error)}</p> : null}
        </div>
    );
};

export default ImportedDocuments;
