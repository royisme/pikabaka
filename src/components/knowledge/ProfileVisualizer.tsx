import React, { useCallback, useMemo, useState } from 'react';
import { Pencil, Plus, RotateCcw, Save, X } from 'lucide-react';
import type { ProfileData } from '../../../electron/knowledge/types';
import { useEditProfile } from '../../hooks/useEditProfile';

interface ProfileEditorProps {
  profileData: ProfileData | null | undefined;
}

type EditableProfileData = Partial<ProfileData>;
type ProfileIdentity = ProfileData['identity'];
type ProfileExperience = ProfileData['experience'][number];
type ProfileProject = ProfileData['projects'][number];
type ProfileEducation = ProfileData['education'][number];

const cardClass = 'bg-bg-item-surface rounded-xl border border-border-subtle p-4';
const labelClass = 'text-[10px] font-bold text-text-primary uppercase tracking-wide';
const inputClass =
  'bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-1 focus:ring-accent-primary focus:border-accent-primary outline-none w-full';
const tagClass =
  'text-[10px] font-medium text-text-secondary px-2 py-1 rounded-md border border-border-subtle bg-bg-input';
const ghostButtonClass =
  'inline-flex items-center gap-1.5 text-[11px] font-medium text-text-tertiary hover:text-text-primary transition-colors';
const primaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-lg bg-text-primary px-3 py-2 text-[11px] font-medium text-bg-main transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

const cloneProfileData = (profileData: ProfileData): EditableProfileData => ({
  ...profileData,
  identity: { ...profileData.identity },
  skills: [...profileData.skills],
  experience: profileData.experience.map((item) => ({
    ...item,
    highlights: [...item.highlights],
  })),
  projects: profileData.projects.map((item) => ({
    ...item,
    technologies: [...item.technologies],
    highlights: [...item.highlights],
  })),
  education: profileData.education.map((item) => ({ ...item })),
});

const splitMultilineList = (value: string) =>
  value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

const splitTagList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const ProfileEditor: React.FC<ProfileEditorProps> = ({ profileData }) => {
  const editProfile = useEditProfile();
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<EditableProfileData | null>(null);
  const [newSkill, setNewSkill] = useState('');

  const startEditing = useCallback(() => {
    if (!profileData) {
      return;
    }

    setEditData(cloneProfileData(profileData));
    setNewSkill('');
    setIsEditing(true);
  }, [profileData]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditData(null);
    setNewSkill('');
  }, []);

  const currentData = useMemo(() => {
    if (isEditing) {
      return editData;
    }

    return profileData;
  }, [editData, isEditing, profileData]);

  const setIdentityField = useCallback(
    <K extends keyof ProfileIdentity>(field: K, value: ProfileIdentity[K]) => {
      setEditData((prev) => {
        if (!prev?.identity) {
          return prev;
        }

        return {
          ...prev,
          identity: {
            ...prev.identity,
            [field]: value,
          },
        };
      });
    },
    []
  );

  const updateExperience = useCallback(
    <K extends keyof ProfileExperience>(index: number, field: K, value: ProfileExperience[K]) => {
      setEditData((prev) => {
        if (!prev?.experience) {
          return prev;
        }

        const experience = [...prev.experience];
        experience[index] = {
          ...experience[index],
          [field]: value,
        };

        return {
          ...prev,
          experience,
        };
      });
    },
    []
  );

  const updateProject = useCallback(
    <K extends keyof ProfileProject>(index: number, field: K, value: ProfileProject[K]) => {
      setEditData((prev) => {
        if (!prev?.projects) {
          return prev;
        }

        const projects = [...prev.projects];
        projects[index] = {
          ...projects[index],
          [field]: value,
        };

        return {
          ...prev,
          projects,
        };
      });
    },
    []
  );

  const updateEducation = useCallback(
    <K extends keyof ProfileEducation>(index: number, field: K, value: ProfileEducation[K]) => {
      setEditData((prev) => {
        if (!prev?.education) {
          return prev;
        }

        const education = [...prev.education];
        education[index] = {
          ...education[index],
          [field]: value,
        };

        return {
          ...prev,
          education,
        };
      });
    },
    []
  );

  const addSkill = useCallback(() => {
    const skill = newSkill.trim();

    if (!skill) {
      return;
    }

    setEditData((prev) => {
      if (!prev?.skills) {
        return prev;
      }

      if (prev.skills.some((existing) => existing.toLowerCase() === skill.toLowerCase())) {
        return prev;
      }

      return {
        ...prev,
        skills: [...prev.skills, skill],
      };
    });

    setNewSkill('');
  }, [newSkill]);

  const removeSkill = useCallback((index: number) => {
    setEditData((prev) => {
      if (!prev?.skills) {
        return prev;
      }

      return {
        ...prev,
        skills: prev.skills.filter((_, skillIndex) => skillIndex !== index),
      };
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!editData) {
      return;
    }

    try {
      await editProfile.mutateAsync(editData);
      setIsEditing(false);
      setEditData(null);
      setNewSkill('');
    } catch (error) {
      console.error('Failed to save profile:', error);
    }
  }, [editData, editProfile]);

  if (!profileData || !currentData) {
    return null;
  }

  const {
    identity,
    skills = [],
    experience = [],
    projects = [],
    education = [],
    totalExperienceYears = 0,
    experienceCount = experience.length,
    projectCount = projects.length,
    nodeCount = skills.length + experience.length + projects.length,
  } = currentData;

  const latestRole = experience[0]?.role || null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-text-primary">Your Background</h2>
        <div className="flex items-center gap-3">
          {isEditing ? (
            <>
              <button type="button" onClick={cancelEditing} className={ghostButtonClass}>
                <RotateCcw size={12} />
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={editProfile.isLoading}
                className={primaryButtonClass}
              >
                <Save size={12} />
                {editProfile.isLoading ? 'Saving...' : 'Save'}
              </button>
            </>
          ) : (
            <button type="button" onClick={startEditing} className={ghostButtonClass}>
              <Pencil size={12} />
              Edit
            </button>
          )}
        </div>
      </div>

      <div className={cardClass}>
        <div className="flex flex-col gap-3">
          <div className={labelClass}>Profile</div>
          {isEditing ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>Name</label>
                <input
                  className={inputClass}
                  value={identity?.name || ''}
                  onChange={(event) => setIdentityField('name', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>Email</label>
                <input
                  className={inputClass}
                  value={identity?.email || ''}
                  onChange={(event) => setIdentityField('email', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>Phone</label>
                <input
                  className={inputClass}
                  value={identity?.phone || ''}
                  onChange={(event) => setIdentityField('phone', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>Location</label>
                <input
                  className={inputClass}
                  value={identity?.location || ''}
                  onChange={(event) => setIdentityField('location', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>LinkedIn</label>
                <input
                  className={inputClass}
                  value={identity?.linkedin || ''}
                  onChange={(event) => setIdentityField('linkedin', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>GitHub</label>
                <input
                  className={inputClass}
                  value={identity?.github || ''}
                  onChange={(event) => setIdentityField('github', event.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold text-text-primary">{identity?.name}</h3>
              {latestRole && <p className="text-sm text-accent-primary">{latestRole}</p>}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {identity?.location && <span className="text-xs text-text-secondary">{identity.location}</span>}
                {identity?.email && <span className="text-xs text-text-secondary">{identity.email}</span>}
                {identity?.phone && <span className="text-xs text-text-secondary">{identity.phone}</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={cardClass}>
        <div className="mb-3 grid grid-cols-4 gap-4">
          <div className="flex flex-col items-center">
            <span className="text-lg font-semibold text-text-primary">{totalExperienceYears}</span>
            <span className="text-xs text-text-secondary">Years</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-lg font-semibold text-text-primary">{experienceCount}</span>
            <span className="text-xs text-text-secondary">Experience</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-lg font-semibold text-text-primary">{projectCount}</span>
            <span className="text-xs text-text-secondary">Projects</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-lg font-semibold text-text-primary">{nodeCount}</span>
            <span className="text-xs text-text-secondary">Highlights</span>
          </div>
        </div>
      </div>

      <div className={cardClass}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className={labelClass}>Skills</div>
          {isEditing && (
            <div className="flex items-center gap-2">
              <input
                className="bg-bg-input border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-text-primary focus:ring-1 focus:ring-accent-primary focus:border-accent-primary outline-none"
                placeholder="Add skill"
                value={newSkill}
                onChange={(event) => setNewSkill(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    addSkill();
                  }
                }}
              />
              <button type="button" onClick={addSkill} className={ghostButtonClass}>
                <Plus size={12} />
                Add
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {skills.map((skill, index) => (
            <span key={`${skill}-${index}`} className={`${tagClass} flex items-center gap-1`}>
              {skill}
              {isEditing && (
                <button
                  type="button"
                  onClick={() => removeSkill(index)}
                  className="text-text-tertiary transition-colors hover:text-text-primary"
                  aria-label={`Remove ${skill}`}
                >
                  <X size={10} />
                </button>
              )}
            </span>
          ))}
        </div>
      </div>

      {experience.length > 0 && (
        <div className={cardClass}>
          <div className={`mb-3 ${labelClass}`}>Experience</div>
          <div className="flex flex-col gap-4">
            {experience.map((item, index) => (
              <div key={`${item.company}-${index}`} className="flex flex-col gap-2 border-b border-border-subtle pb-4 last:border-b-0 last:pb-0">
                {isEditing ? (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <label className={labelClass}>Company</label>
                        <input
                          className={inputClass}
                          value={item.company}
                          onChange={(event) => updateExperience(index, 'company', event.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className={labelClass}>Role</label>
                        <input
                          className={inputClass}
                          value={item.role}
                          onChange={(event) => updateExperience(index, 'role', event.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className={labelClass}>Start Date</label>
                        <input
                          className={inputClass}
                          value={item.startDate}
                          onChange={(event) => updateExperience(index, 'startDate', event.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className={labelClass}>End Date</label>
                        <input
                          className={inputClass}
                          value={item.endDate || ''}
                          onChange={(event) => updateExperience(index, 'endDate', event.target.value || undefined)}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>Highlights</label>
                      <textarea
                        className={`${inputClass} min-h-[96px] resize-y`}
                        value={item.highlights.join('\n')}
                        onChange={(event) => updateExperience(index, 'highlights', splitMultilineList(event.target.value))}
                        placeholder="One highlight per line"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-text-primary">{item.company}</span>
                      <span className="text-xs text-text-tertiary">
                        {item.startDate} - {item.endDate || 'Present'}
                      </span>
                    </div>
                    <span className="text-xs text-accent-primary">{item.role}</span>
                    {item.highlights.length > 0 && (
                      <ul className="mt-1 flex flex-col gap-1">
                        {item.highlights.map((highlight, highlightIndex) => (
                          <li key={`${highlight}-${highlightIndex}`} className="text-xs text-text-secondary">
                            • {highlight}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length > 0 && (
        <div className={cardClass}>
          <div className={`mb-3 ${labelClass}`}>Projects</div>
          <div className="flex flex-col gap-4">
            {projects.map((item, index) => (
              <div key={`${item.name}-${index}`} className="flex flex-col gap-2 border-b border-border-subtle pb-4 last:border-b-0 last:pb-0">
                {isEditing ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>Project Name</label>
                      <input
                        className={inputClass}
                        value={item.name}
                        onChange={(event) => updateProject(index, 'name', event.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>Description</label>
                      <textarea
                        className={`${inputClass} min-h-[88px] resize-y`}
                        value={item.description}
                        onChange={(event) => updateProject(index, 'description', event.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <label className={labelClass}>Technologies</label>
                        <input
                          className={inputClass}
                          value={item.technologies.join(', ')}
                          onChange={(event) => updateProject(index, 'technologies', splitTagList(event.target.value))}
                          placeholder="React, TypeScript, Electron"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className={labelClass}>Highlights</label>
                        <textarea
                          className={`${inputClass} min-h-[88px] resize-y`}
                          value={item.highlights.join('\n')}
                          onChange={(event) => updateProject(index, 'highlights', splitMultilineList(event.target.value))}
                          placeholder="One highlight per line"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium text-text-primary">{item.name}</span>
                    <p className="text-xs text-text-secondary">{item.description}</p>
                    {item.technologies.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {item.technologies.map((technology, technologyIndex) => (
                          <span key={`${technology}-${technologyIndex}`} className={tagClass}>
                            {technology}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.highlights.length > 0 && (
                      <ul className="mt-1 flex flex-col gap-1">
                        {item.highlights.map((highlight, highlightIndex) => (
                          <li key={`${highlight}-${highlightIndex}`} className="text-xs text-text-tertiary">
                            • {highlight}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {education.length > 0 && (
        <div className={cardClass}>
          <div className={`mb-3 ${labelClass}`}>Education</div>
          <div className="flex flex-col gap-4">
            {education.map((item, index) => (
              <div key={`${item.institution}-${index}`} className="border-b border-border-subtle pb-4 last:border-b-0 last:pb-0">
                {isEditing ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>Institution</label>
                      <input
                        className={inputClass}
                        value={item.institution}
                        onChange={(event) => updateEducation(index, 'institution', event.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>Degree</label>
                      <input
                        className={inputClass}
                        value={item.degree}
                        onChange={(event) => updateEducation(index, 'degree', event.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>Year</label>
                      <input
                        className={inputClass}
                        value={item.year || ''}
                        onChange={(event) => updateEducation(index, 'year', event.target.value || undefined)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="text-sm text-text-primary">{item.institution}</span>
                      <span className="text-xs text-text-secondary">{item.degree}</span>
                    </div>
                    {item.year && <span className="text-xs text-text-tertiary">{item.year}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export { ProfileEditor as ProfileVisualizer };
