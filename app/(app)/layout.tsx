import Nav from "@/components/Nav";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24 sm:pb-10">
        {children}
      </main>
    </>
  );
}
