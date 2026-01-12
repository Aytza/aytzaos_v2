import type { RoadmapItem } from '../../types';
import { TEAM_MEMBERS } from '../../types';

interface RoadmapCardProps {
  item: RoadmapItem;
  onDragStart: () => void;
  onClick: () => void;
}

const SIZE_LABELS: Record<string, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
};

function getOwnerInitials(email: string | null): string {
  if (!email) return '';
  const member = TEAM_MEMBERS.find((m) => m.email === email);
  if (member) {
    const parts = member.name.split(' ');
    return parts.map((p) => p[0]).join('').toUpperCase();
  }
  return email[0].toUpperCase();
}

function formatDateRange(startDate: string | null, endDate: string | null): string {
  if (!startDate && !endDate) return '';

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (startDate && endDate) {
    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  }
  if (startDate) {
    return `From ${formatDate(startDate)}`;
  }
  return `Until ${formatDate(endDate!)}`;
}

export function RoadmapCard({ item, onDragStart, onClick }: RoadmapCardProps) {
  const dateRange = formatDateRange(item.startDate, item.endDate);

  return (
    <div
      className="roadmap-card"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
    >
      <div className="roadmap-card-title">{item.title}</div>

      <div className="roadmap-card-meta">
        {item.size && (
          <span className={`roadmap-card-size size-${item.size.toLowerCase()}`}>
            {SIZE_LABELS[item.size]}
          </span>
        )}

        {dateRange && (
          <span className="roadmap-card-dates">{dateRange}</span>
        )}

        {item.ownerEmail && (
          <span className="roadmap-card-owner" title={item.ownerEmail}>
            {getOwnerInitials(item.ownerEmail)}
          </span>
        )}
      </div>

      {item.notes && (
        <div className="roadmap-card-notes">{item.notes}</div>
      )}
    </div>
  );
}
