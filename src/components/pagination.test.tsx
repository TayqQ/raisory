import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageNav, Pagination } from "./pagination";

const hrefFor = (page: number) => `/p/${page}`;

describe("PageNav", () => {
  it("shows nothing for a single page", () => {
    const { container } = render(
      <PageNav page={1} pages={1} hrefFor={hrefFor} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers only Next and Last on the first page", () => {
    render(<PageNav page={1} pages={9} hrefFor={hrefFor} />);
    expect(screen.queryByRole("link", { name: /First/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Previous/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute(
      "href",
      "/p/2",
    );
    expect(screen.getByRole("link", { name: /Last/ })).toHaveAttribute(
      "href",
      "/p/9",
    );
    expect(screen.getByText("Page 1 of 9")).toBeInTheDocument();
  });

  it("offers all four in the middle", () => {
    render(<PageNav page={4} pages={9} hrefFor={hrefFor} />);
    expect(screen.getByRole("link", { name: /First/ })).toHaveAttribute(
      "href",
      "/p/1",
    );
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute(
      "href",
      "/p/3",
    );
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute(
      "href",
      "/p/5",
    );
    expect(screen.getByRole("link", { name: /Last/ })).toHaveAttribute(
      "href",
      "/p/9",
    );
  });

  it("offers only First and Previous on the last page", () => {
    render(<PageNav page={9} pages={9} hrefFor={hrefFor} />);
    expect(screen.getByRole("link", { name: /First/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Previous/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Next/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Last/ })).toBeNull();
  });
});

describe("Pagination", () => {
  it("keeps the filters and drops the page for page 1", () => {
    render(
      <Pagination
        filters={{ page: 3, pageSize: 24, tag: "robotics" }}
        total={240}
        page={3}
        pageSize={24}
      />,
    );
    expect(screen.getByRole("link", { name: /First/ })).toHaveAttribute(
      "href",
      "/?tag=robotics",
    );
    expect(screen.getByRole("link", { name: /Last/ })).toHaveAttribute(
      "href",
      "/?tag=robotics&page=10",
    );
  });
});
