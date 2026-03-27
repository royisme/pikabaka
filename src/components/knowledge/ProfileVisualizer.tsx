import React from 'react';

interface ProfileData {
  identity: {
    name: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    github?: string;
  };
  skills: string[];
  experience: {
    company: string;
    role: string;
    startDate: string;
    endDate?: string;
    highlights: string[];
  }[];
  projects: {
    name: string;
    description: string;
    technologies: string[];
    highlights: string[];
  }[];
  education: {
    institution: string;
    degree: string;
    year?: string;
  }[];
  totalExperienceYears: number;
  experienceCount: number;
  projectCount: number;
  nodeCount: number;
  rawText: string;
  hasActiveJD: boolean;
  activeJD?: any;
}

interface ProfileVisualizerProps {
  profileData: ProfileData | null | undefined;
}

export const ProfileVisualizer: React.FC<ProfileVisualizerProps> = ({ profileData }) => {
  if (!profileData) {
    return null;
  }

  const { identity, skills, experience, projects, education, totalExperienceYears, experienceCount, projectCount, nodeCount } = profileData;

  const latestRole = experience?.[0]?.role || null;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Summary Card */}
      <div className="bg-surface-2 rounded-lg p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-text-primary text-lg font-semibold">{identity.name}</h2>
          {latestRole && <p className="text-accent-primary text-sm">{latestRole}</p>}
          {identity.location && <p className="text-text-muted text-xs">{identity.location}</p>}
        </div>
      </div>

      {/* Stats Row */}
      <div className="bg-surface-2 rounded-lg p-4">
        <div className="grid grid-cols-4 gap-4">
          <div className="flex flex-col items-center">
            <span className="text-text-primary text-lg font-semibold">{totalExperienceYears}</span>
            <span className="text-text-muted text-xs">Years</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-text-primary text-lg font-semibold">{experienceCount}</span>
            <span className="text-text-muted text-xs">Experience</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-text-primary text-lg font-semibold">{projectCount}</span>
            <span className="text-text-muted text-xs">Projects</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-text-primary text-lg font-semibold">{nodeCount}</span>
            <span className="text-text-muted text-xs">Nodes</span>
          </div>
        </div>
      </div>

      {/* Skills */}
      {skills.length > 0 && (
        <div className="bg-surface-2 rounded-lg p-4">
          <h3 className="text-text-secondary text-xs font-medium mb-2">Skills</h3>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((skill, index) => (
              <span
                key={index}
                className="bg-surface-3 text-text-primary text-xs px-2 py-0.5 rounded"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Experience Timeline */}
      {experience.length > 0 && (
        <div className="bg-surface-2 rounded-lg p-4">
          <h3 className="text-text-secondary text-xs font-medium mb-3">Experience</h3>
          <div className="flex flex-col gap-3">
            {experience.map((exp, index) => (
              <div key={index} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-text-primary text-sm font-medium">{exp.company}</span>
                  <span className="text-text-muted text-xs">
                    {exp.startDate} – {exp.endDate || 'Present'}
                  </span>
                </div>
                <span className="text-accent-primary text-xs">{exp.role}</span>
                {exp.highlights.length > 0 && (
                  <ul className="flex flex-col gap-0.5 mt-1">
                    {exp.highlights.map((highlight, hIndex) => (
                      <li key={hIndex} className="text-text-secondary text-xs">
                        • {highlight}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Projects */}
      {projects.length > 0 && (
        <div className="bg-surface-2 rounded-lg p-4">
          <h3 className="text-text-secondary text-xs font-medium mb-3">Projects</h3>
          <div className="flex flex-col gap-3">
            {projects.map((project, index) => (
              <div key={index} className="flex flex-col gap-1">
                <span className="text-text-primary text-sm font-medium">{project.name}</span>
                <p className="text-text-secondary text-xs">{project.description}</p>
                {project.technologies.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {project.technologies.map((tech, tIndex) => (
                      <span
                        key={tIndex}
                        className="bg-surface-3 text-accent-primary text-xs px-1.5 py-0.5 rounded"
                      >
                        {tech}
                      </span>
                    ))}
                  </div>
                )}
                {project.highlights.length > 0 && (
                  <ul className="flex flex-col gap-0.5 mt-1">
                    {project.highlights.map((highlight, hIndex) => (
                      <li key={hIndex} className="text-text-muted text-xs">
                        • {highlight}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Education */}
      {education.length > 0 && (
        <div className="bg-surface-2 rounded-lg p-4">
          <h3 className="text-text-secondary text-xs font-medium mb-3">Education</h3>
          <div className="flex flex-col gap-2">
            {education.map((edu, index) => (
              <div key={index} className="flex items-baseline justify-between">
                <div className="flex flex-col">
                  <span className="text-text-primary text-sm">{edu.institution}</span>
                  <span className="text-text-secondary text-xs">{edu.degree}</span>
                </div>
                {edu.year && <span className="text-text-muted text-xs">{edu.year}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
