type ProjectFilterProps = {
  featuredOnly: boolean;
  query: string;
};

export function ProjectFilter({ featuredOnly, query }: ProjectFilterProps) {
  return (
    <section>
      <input value={query} />
      <button>{featuredOnly ? "Showing featured" : "Show featured"}</button>
      <span>{query ? `Results for ${query}` : "All projects"}</span>
    </section>
  );
}
