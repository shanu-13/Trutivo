import Image from 'next/image';

// The official Trutivo logo (public/trutivo-logo.png), shown as supplied: its
// proportions are kept by fixing only the height. It is navy on transparent,
// so it is always placed on a white or off-white surface.
export default function BrandLogo({ className = 'h-8 w-auto', priority = false }: { className?: string; priority?: boolean }) {
  return <Image src="/trutivo-logo.png" alt="Trutivo" width={3651} height={1088} priority={priority} className={className} />;
}
