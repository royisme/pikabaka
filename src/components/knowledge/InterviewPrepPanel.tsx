import React, { useState, useEffect } from 'react';
import { X, Target, ChevronDown, ChevronUp, AlertTriangle, Sparkles, Zap, BookOpen } from 'lucide-react';
import { useGeneratePrep } from '../../hooks/useInterviewPrep';
import type { InterviewPrepData, InterviewPrepQuestion } from '../../../electron/knowledge/types';

interface InterviewPrepPanelProps {
  isOpen: boolean;
  onClose: () => void;
  jdId?: number;
  jdTitle?: string;
  jdCompany?: string;
}

const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
  behavioral: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  technical: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  system_design: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
  intro: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
};

const difficultyLabels = ['Easy', 'Medium', 'Hard'];

export const InterviewPrepPanel: React.FC<InterviewPrepPanelProps> = ({
  isOpen, onClose, jdId, jdTitle, jdCompany,
}) => {
  const { mutateAsync: generatePrepAsync, isLoading: prepLoading, isError: prepError, error: prepErrorObj } = useGeneratePrep();
  const [prepData, setPrepData] = useState<InterviewPrepData | null>(null);
  const [expandedQuestions, setExpandedQuestions] = useState<Set<number>>(new Set([0]));
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && !prepData && !prepLoading) {
      generatePrepAsync(jdId).then((data) => {
        setPrepData(data);
      }).catch(() => {});
    }
  }, [isOpen, jdId, prepData, prepLoading]);

  useEffect(() => {
    if (!isOpen) {
      setPrepData(null);
      setExpandedQuestions(new Set([0]));
      setActiveCategory(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleQuestion = (index: number) => {
    setExpandedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const filteredQuestions = prepData?.likelyQuestions?.filter(
    (q) => !activeCategory || q.category === activeCategory,
  ) || [];

  const categories = [...new Set(prepData?.likelyQuestions?.map((q) => q.category) || [])];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-bg-main rounded-2xl border border-border-subtle shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-border-subtle flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
              <Target size={16} className="text-accent-primary" />
              Interview Prep
            </h2>
            <p className="text-xs text-text-secondary mt-0.5">
              {jdTitle} {jdCompany ? `at ${jdCompany}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary p-1.5 rounded-lg hover:bg-bg-input transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
          {prepLoading ? (
            <div className="space-y-4">
              <div className="animate-pulse">
                <div className="h-20 bg-bg-input rounded-xl" />
                <div className="h-4 bg-bg-input rounded w-2/3 mt-4" />
                <div className="h-32 bg-bg-input rounded-xl mt-3" />
                <div className="h-32 bg-bg-input rounded-xl mt-3" />
              </div>
              <p className="text-xs text-text-secondary text-center">Generating interview preparation materials...</p>
            </div>
          ) : prepError ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
              <AlertTriangle size={20} className="mx-auto text-red-400 mb-2" />
              <p className="text-sm text-red-400 font-medium">Failed to generate prep</p>
              <p className="text-xs text-text-secondary mt-1">{(prepErrorObj as Error | undefined)?.message}</p>
              <button
                onClick={() => generatePrepAsync(jdId).then((d) => setPrepData(d)).catch(() => {})}
                className="mt-3 px-4 py-1.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : prepData ? (
            <>
              <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-4">
                <div className="flex items-center gap-4">
                  <div className="relative w-16 h-16 shrink-0">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" className="text-bg-input" strokeWidth="3" />
                      <circle
                        cx="18"
                        cy="18"
                        r="15.5"
                        fill="none"
                        stroke={prepData.matchScore >= 70 ? '#10b981' : prepData.matchScore >= 40 ? '#f59e0b' : '#ef4444'}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={`${prepData.matchScore * 0.974} 100`}
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-text-primary">
                      {prepData.matchScore}%
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide mb-1">Match Score</div>
                    <p className="text-xs text-text-secondary">
                      {prepData.matchScore >= 70 ? 'Strong match — focus on showcasing depth' :
                       prepData.matchScore >= 40 ? 'Moderate match — emphasize transferable skills' :
                       'Gap-heavy — prepare to address missing skills proactively'}
                    </p>
                  </div>
                </div>

                {prepData.openingPitch && (
                  <div className="mt-4 pt-4 border-t border-border-subtle">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Sparkles size={12} className="text-accent-primary" />
                      <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide">Opening Pitch</div>
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed bg-bg-input rounded-lg p-3 italic">
                      "{prepData.openingPitch}"
                    </p>
                  </div>
                )}
              </div>

              {prepData.mustMentionKeywords?.length > 0 && (
                <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Zap size={12} className="text-yellow-400" />
                    <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide">Keywords to Mention</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {prepData.mustMentionKeywords.map((kw, i) => (
                      <span key={i} className="text-[10px] font-medium text-yellow-400 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {prepData.knowledgeGaps?.length > 0 && (
                <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <AlertTriangle size={12} className="text-red-400" />
                    <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide">Skill Gaps</div>
                    <span className="text-[9px] text-text-tertiary ml-1">({prepData.knowledgeGaps.length})</span>
                  </div>
                  <div className="space-y-2">
                    {prepData.knowledgeGaps.map((gap, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 ${
                          gap.importance === 'critical'
                            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                            : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                        }`}>
                          {gap.importance === 'critical' ? 'CRITICAL' : 'NICE TO HAVE'}
                        </span>
                        <div>
                          <span className="text-xs font-medium text-text-primary">{gap.skill}</span>
                          <p className="text-[11px] text-text-secondary mt-0.5">{gap.suggestion}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <BookOpen size={12} className="text-accent-primary" />
                    <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide">
                      Likely Questions ({filteredQuestions.length})
                    </div>
                  </div>

                  <div className="flex gap-1 flex-wrap">
                    <button
                      onClick={() => setActiveCategory(null)}
                      className={`text-[9px] font-medium px-2 py-0.5 rounded-full transition-colors ${
                        !activeCategory ? 'bg-accent-primary/10 text-accent-primary border border-accent-primary/20' : 'text-text-tertiary hover:text-text-secondary'
                      }`}
                    >
                      All
                    </button>
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
                        className={`text-[9px] font-medium px-2 py-0.5 rounded-full transition-colors ${
                          activeCategory === cat
                            ? `${categoryColors[cat]?.bg} ${categoryColors[cat]?.text} border ${categoryColors[cat]?.border}`
                            : 'text-text-tertiary hover:text-text-secondary'
                        }`}
                      >
                        {cat.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  {filteredQuestions.map((q: InterviewPrepQuestion, i) => {
                    const colors = categoryColors[q.category] || categoryColors.technical;
                    const isExpanded = expandedQuestions.has(i);

                    return (
                      <div key={i} className="bg-bg-item-surface rounded-xl border border-border-subtle overflow-hidden">
                        <button
                          onClick={() => toggleQuestion(i)}
                          className="w-full p-4 flex items-start gap-3 text-left hover:bg-bg-input/30 transition-colors"
                        >
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} border ${colors.border} shrink-0 mt-0.5`}>
                            {q.category.replace('_', ' ').toUpperCase()}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-text-primary font-medium">{q.question}</p>
                            {q.relatedJDRequirement && (
                              <p className="text-[10px] text-text-tertiary mt-1">Tests: {q.relatedJDRequirement}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[9px] text-text-tertiary">
                              {difficultyLabels[(q.difficulty || 1) - 1]}
                            </span>
                            {isExpanded ? <ChevronUp size={14} className="text-text-tertiary" /> : <ChevronDown size={14} className="text-text-tertiary" />}
                          </div>
                        </button>

                        {isExpanded && q.suggestedAnswer && (
                          <div className="px-4 pb-4 border-t border-border-subtle">
                            <div className="pt-3 space-y-2">
                              {q.suggestedAnswer.opening && (
                                <div>
                                  <div className="text-[9px] font-bold text-text-secondary uppercase tracking-wide mb-1">Opening</div>
                                  <p className="text-xs text-text-primary italic bg-bg-input rounded-lg px-3 py-2">"{q.suggestedAnswer.opening}"</p>
                                </div>
                              )}
                              {q.suggestedAnswer.keyPoints?.length > 0 && (
                                <div>
                                  <div className="text-[9px] font-bold text-text-secondary uppercase tracking-wide mb-1">Key Points</div>
                                  <ul className="space-y-1">
                                    {q.suggestedAnswer.keyPoints.map((point, pi) => (
                                      <li key={pi} className="text-xs text-text-secondary flex items-start gap-2">
                                        <span className="text-accent-primary mt-0.5">•</span> {point}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {q.suggestedAnswer.evidence && (
                                <div>
                                  <div className="text-[9px] font-bold text-text-secondary uppercase tracking-wide mb-1">Evidence from Resume</div>
                                  <p className="text-[11px] text-accent-primary bg-accent-primary/5 rounded-lg px-3 py-2 border border-accent-primary/10">
                                    {q.suggestedAnswer.evidence}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {prepData && (
          <div className="p-4 border-t border-border-subtle shrink-0 flex items-center justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-full text-xs font-medium text-text-tertiary hover:text-text-primary hover:bg-bg-input transition-colors">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
