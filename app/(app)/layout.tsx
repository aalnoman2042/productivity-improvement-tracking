import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Nav />
      <main className="app-main mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-4 sm:py-6">
        {children}
        <Footer className="mt-10" />
      </main>
    </>
  );
}
