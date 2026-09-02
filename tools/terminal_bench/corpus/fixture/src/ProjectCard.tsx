type ProjectCardProps = {
  artist: string;
  title: string;
};

export function ProjectCard({ artist, title }: ProjectCardProps) {
  return (
    <article data-artist={artist}>
      <h2>{title}</h2>
    </article>
  );
}
