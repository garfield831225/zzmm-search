import NonFilmList from '@/components/NonFilmList';

export default function SportsPage() {
  return (
    <NonFilmList
      category="体育"
      title="体育资源"
      icon="⚽"
      description="赛事 / 纪录片"
      accentColor="from-green-500 to-emerald-600"
    />
  );
}
