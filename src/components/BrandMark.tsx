export function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10.5 12.2L13.4 6.2M21.5 12.2L18.6 6.2"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <rect x="4" y="11.2" width="24" height="3.2" rx="1.6" fill="currentColor" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M6.2 14.4H25.8L24.1 24.2C23.88 25.48 22.77 26.4 21.47 26.4H10.53C9.23 26.4 8.12 25.48 7.9 24.2L6.2 14.4ZM11.4 17.4C10.85 17.4 10.4 17.85 10.4 18.4V22.4C10.4 22.95 10.85 23.4 11.4 23.4C11.95 23.4 12.4 22.95 12.4 22.4V18.4C12.4 17.85 11.95 17.4 11.4 17.4ZM16 17.4C15.45 17.4 15 17.85 15 18.4V22.4C15 22.95 15.45 23.4 16 23.4C16.55 23.4 17 22.95 17 22.4V18.4C17 17.85 16.55 17.4 16 17.4ZM20.6 17.4C20.05 17.4 19.6 17.85 19.6 18.4V22.4C19.6 22.95 20.05 23.4 20.6 23.4C21.15 23.4 21.6 22.95 21.6 22.4V18.4C21.6 17.85 21.15 17.4 20.6 17.4Z"
      />
    </svg>
  );
}
