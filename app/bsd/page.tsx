import CesiumShowcase from '@/components/CesiumShowcase';

export const metadata = {
  title: 'BSD City 3D Orbit Showcase | Spindonesia Tiles',
  description: 'BSD City 3D boundary, surround view, and smooth cinematic orbit.',
};

export default function BsdPage() {
  return <CesiumShowcase initialMode="bsd" />;
}
