import React, { useState } from 'react';

interface EconQuestLogoProps {
  className?: string;
  size?: number;
}

// 96px copy for the header (shown at up to 38px); the full-size logo stays for the favicon and docs.
import logoUrl from '../assets/images/econquest_logo_96.png';

export const ECONQUEST_LOGO_ASSET_PATH = logoUrl;

/**
 * Institutional Three-Pillar Sovereign Council Emblem for EconQuest.
 * Uses the generated institutional brand mark with an inline geometric fallback.
 */
export const EconQuestLogo: React.FC<EconQuestLogoProps> = ({
  className = '',
  size = 38,
}) => {
  const [imageError, setImageError] = useState(false);

  if (!imageError) {
    return (
      <img
        src={ECONQUEST_LOGO_ASSET_PATH}
        alt="EconQuest Sovereign Council Orchestrator Logo"
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setImageError(true)}
        className={`shrink-0 select-none object-cover  border border-slate-700/80  ${className}`}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 select-none ${className}`}
      role="img"
      aria-label="EconQuest Sovereign Council Orchestrator Emblem"
    >
      <rect width="64" height="64" rx="6" fill="#0B0F17" />
      <circle
        cx="32"
        cy="28"
        r="16"
        stroke="#F59E0B"
        strokeWidth="3.2"
        strokeDasharray="65 35"
      />
      <circle
        cx="26"
        cy="36"
        r="16"
        stroke="#3B82F6"
        strokeWidth="3.2"
        strokeDasharray="65 35"
      />
      <circle
        cx="38"
        cy="36"
        r="16"
        stroke="#10B981"
        strokeWidth="3.2"
        strokeDasharray="65 35"
      />
      <polygon points="32,12 40,26 32,33 24,26" fill="#F59E0B" />
      <polygon points="32,33 24,26 14,43 29,43" fill="#3B82F6" />
      <polygon points="32,33 40,26 50,43 35,43" fill="#10B981" />
    </svg>
  );
};
