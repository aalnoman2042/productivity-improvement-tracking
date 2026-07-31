/** The PIT mark — rising bars with a trend arrow, on the brand gradient. */
export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="pit-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3d8ae8" />
          <stop offset="55%" stopColor="#1c5cab" />
          <stop offset="100%" stopColor="#4a3aa7" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill="url(#pit-brand)" />
      <rect x="104" y="300" width="72" height="108" rx="22" fill="#fff" opacity="0.55" />
      <rect x="220" y="248" width="72" height="160" rx="22" fill="#fff" opacity="0.78" />
      <rect x="336" y="176" width="72" height="232" rx="22" fill="#fff" />
      <path
        d="M128 236 L246 166 L372 96"
        fill="none"
        stroke="#fff"
        strokeWidth="28"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M296 92 L380 92 L380 176"
        fill="none"
        stroke="#fff"
        strokeWidth="28"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
