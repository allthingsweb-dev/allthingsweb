defmodule App.Seed do
  @moduledoc """
  Seeds the database with test data.
  """

  alias App.Repo
  alias App.Accounts.User

  alias App.Hacks.Category
  alias App.Hacks.Hack

  def seed() do
    Repo.insert!(%Category{
      id: "f07c7571-74df-4885-baa9-7269c845e57e",
      name: "Creative"
    })

    Repo.insert!(%Category{
      id: "f07c7571-74df-4885-baa9-7269c845e57f",
      name: "Impactful"
    })

    Repo.insert!(%Hack{
      id: "f07c7571-74df-4885-baa9-7269c845e57b",
      name: "Hack 1",
      description:
        "Lorem ipsum dolor sit amet consectetur adipisicing elit. Accusamus in ad tempora provident dolor quod suscipit, hic ipsum accusantium at dicta fuga iste molestias? Cupiditate odit inventore dolorum maxime deleniti?",
      votes: 0
    })

    Repo.insert!(%Hack{
      id: "f07c7571-74df-4885-baa9-7269c845e57c",
      name: "Hack 2",
      description:
        "Lorem ipsum dolor sit amet consectetur adipisicing elit. Accusamus in ad tempora provident dolor quod suscipit, hic ipsum accusantium at dicta fuga iste molestias? Cupiditate odit inventore dolorum maxime deleniti?",
      votes: 0
    })

    Repo.insert!(%Hack{
      id: "f07c7571-74df-4885-baa9-7269c845e57d",
      name: "Hack 3",
      description:
        "Lorem ipsum dolor sit amet consectetur adipisicing elit. Accusamus in ad tempora provident dolor quod suscipit, hic ipsum accusantium at dicta fuga iste molestias? Cupiditate odit inventore dolorum maxime deleniti?",
      votes: 0
    })

    Repo.insert!(%User{
      id: "2dc85741-ec60-41bc-a493-3db1f8d48914",
      email: "andre.timo.landgraf@gmail.com"
    })

    Repo.insert!(%User{
      id: "8623b244-9ee6-471f-b238-0ece985689c9",
      email: "tony@tonydang.com"
    })
  end
end
