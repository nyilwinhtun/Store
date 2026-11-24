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
        d="M11.25 11V9.5a4.75 4.75 0 0 1 9.5 0V11"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <rect
        x="5.5"
        y="10.5"
        width="21"
        height="16.5"
        rx="4.25"
        fill="currentColor"
      />
      <path
        d="M11.5 17.25h9M11.5 21.25h6"
        stroke="#006be6"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}
