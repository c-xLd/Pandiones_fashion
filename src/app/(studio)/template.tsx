/** Re-mounts on every navigation inside the studio: gentle page enter animation. */
export default function StudioTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
