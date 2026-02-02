/**
 * Skills list component with enable/disable toggles.
 */
import { useState, useMemo } from 'react';
import { useSettings, useAvailableSkills, useSetSkillEnabled } from '../../hooks/useSettings';
import './SkillsList.css';

export default function SkillsList() {
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const { data: skills, isLoading: skillsLoading } = useAvailableSkills();
  const setSkillEnabled = useSetSkillEnabled();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const isLoading = settingsLoading || skillsLoading;

  const categories = useMemo(() => {
    if (!skills) return [];
    const cats = new Set(skills.map((s) => s.category));
    return Array.from(cats).sort();
  }, [skills]);

  const filteredSkills = useMemo(() => {
    if (!skills) return [];
    return skills.filter((skill) => {
      if (categoryFilter && skill.category !== categoryFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          skill.name.toLowerCase().includes(q) ||
          skill.id.toLowerCase().includes(q) ||
          skill.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [skills, search, categoryFilter]);

  const isSkillEnabled = (skillId: string): boolean => {
    if (!settings) return true;
    const skill = settings.skills.find((s) => s.skillId === skillId);
    return skill?.enabled ?? true;
  };

  const handleToggle = (skillId: string) => {
    const currentEnabled = isSkillEnabled(skillId);
    setSkillEnabled.mutate({ skillId, enabled: !currentEnabled });
  };

  if (isLoading) {
    return (
      <div className="skills-list loading">
        <span className="spinner-small"></span>
        Loading skills...
      </div>
    );
  }

  return (
    <div className="skills-list">
      <div className="skills-search">
        <input
          type="text"
          placeholder="Search skills..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="skills-categories">
        <button
          className={`category-btn ${!categoryFilter ? 'active' : ''}`}
          onClick={() => setCategoryFilter(null)}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            className={`category-btn ${categoryFilter === cat ? 'active' : ''}`}
            onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="skills-grid">
        {filteredSkills.map((skill) => (
          <div key={skill.id} className="skill-item">
            <div className="skill-info">
              <span className="skill-name">{skill.name}</span>
              <span className="skill-category">{skill.category}</span>
            </div>
            <button
              className={`skill-toggle ${isSkillEnabled(skill.id) ? 'enabled' : 'disabled'}`}
              onClick={() => handleToggle(skill.id)}
              disabled={setSkillEnabled.isPending}
            >
              <span className="toggle-track">
                <span className="toggle-thumb" />
              </span>
            </button>
          </div>
        ))}
      </div>

      {filteredSkills.length === 0 && (
        <div className="skills-empty">
          <p>No skills match your search</p>
        </div>
      )}
    </div>
  );
}
