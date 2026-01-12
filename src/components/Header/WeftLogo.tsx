/**
 * Aytza Logo Component
 *
 * The Aytza wordmark logo in brand purple.
 */

interface WeftLogoProps {
  onClick?: () => void;
}

export function WeftLogo({ onClick }: WeftLogoProps) {
  return (
    <div className="weft-logo" onClick={onClick}>
      <svg
        width="80"
        height="32"
        viewBox="0 0 733 288"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="weft-logo-icon"
      >
        <g clipPath="url(#clip0_logo)">
          <path d="M413.268 6.0752V69.6862H566.052V98.1456L499.048 182.867H564.04V223.705H430.019V194.575L497.036 109.881L413.268 110.538V223.705H365.362L364.356 222.699V110.538H334.877L259.826 288H209.559L244.362 212.654L186.116 69.6862H238.381L268.865 162.106L300.356 69.6862H364.356V6.0752H413.268Z" fill="currentColor"/>
          <path d="M0.5 223.705L88.614 0.710813L133.543 0L221.63 223.705H169.7L153.647 182.813L66.9409 182.947L51.7724 223.705H0.5ZM82.2435 142.015H139.873L110.73 63.6647L82.2435 142.015Z" fill="currentColor"/>
          <path d="M683.98 81.7433V69.6863H732.221V222.699L731.215 223.705H684.986L683.98 222.699V211.648C661.851 230.76 626.914 231.055 602.813 215.417C555.47 184.691 556.409 104.557 605.375 75.8422C629.328 61.7869 663.071 62.4575 683.98 81.7433ZM651.028 110.042C609.157 111.222 605.75 174.029 644.416 181.888C696.372 192.443 701.16 108.634 651.028 110.042Z" fill="currentColor"/>
        </g>
        <defs>
          <clipPath id="clip0_logo">
            <rect width="733" height="288" fill="white"/>
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}
