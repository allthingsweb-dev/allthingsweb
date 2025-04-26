defmodule App.HacksFixtures do
  @moduledoc """
  This module defines test helpers for creating
  entities via the `App.Hacks` context.
  """

  @doc """
  Generate a hack.
  """
  def hack_fixture(scope, attrs \\ %{}) do
    attrs =
      Enum.into(attrs, %{
        description: "some description",
        name: "some name",
        votes: 42
      })

    {:ok, hack} = App.Hacks.create_hack(scope, attrs)
    hack
  end
end
