import React from 'react';
import { splitSettingsLinks } from '../utils/settingsLinks';
import { openSettings } from './SettingsDialog';

/** Help text in which "Menu > Settings > …" and "Menu > Settings > AI model" open that page of Settings. */
export const SettingsText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {splitSettingsLinks(text).map((part, i) =>
      typeof part === 'string' ? (
        <React.Fragment key={i}>{part}</React.Fragment>
      ) : (
        <button
          key={i}
          type="button"
          className="text-blue-700 dark:text-blue-300 underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-200"
          onClick={() => openSettings(part.page)}
          data-settings-link={part.page}
        >
          {part.text}
        </button>
      )
    )}
  </>
);
