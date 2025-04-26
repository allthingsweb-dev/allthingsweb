defmodule App.Repo.Migrations.CreateHacks do
  use Ecto.Migration

  def change do
    # "categories" table __________________________________________________________________________
    create table(:categories) do
      add :name, :string

      timestamps()
    end

    # "hacks" table ________________________________________________________________________________
    create table(:hacks) do
      add :name, :string
      add :description, :string
      add :votes, :integer

      add :user_id, references(:users, on_delete: :delete_all)

      timestamps()
    end

    create index(:hacks, [:user_id])

    # "votes" table __________________________________________________________________________
    create table(:votes) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :category_id, references(:categories), null: false
      add :hack_id, references(:hacks), null: false

      timestamps()
    end

    create index(:votes, [:user_id, :hack_id, :category_id])
  end
end
