export type RepositoryLinkParameters = Partial<
  Record<"repository" | "ref" | "path" | "base" | "tag" | "asset", string>
>;

export function formatRepositoryLink(
  template: string,
  repositoryUrl: string,
  parameters?: RepositoryLinkParameters,
): string;
