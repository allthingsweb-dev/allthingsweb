defmodule App.Services.Countdown do
  @moduledoc """
  A GenServer to manage countdown state and broadcast changes to clients.
  """

  use GenServer

  # API

  def start_link(init_arg) do
    GenServer.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  def get_state() do
    GenServer.call(__MODULE__, :get_state)
  end

  def set_state(new_state) do
    GenServer.cast(__MODULE__, {:set_state, new_state})
  end

  def start() do
    GenServer.cast(__MODULE__, :start_countdown)
  end

  def stop() do
    GenServer.cast(__MODULE__, :stop_countdown)
  end

  # Callbacks

  @impl true
  def init(_init_arg) do
    state = %{deadline: DateTime.utc_now(), running: false}
    {:ok, state}
  end

  @impl true
  def handle_call(:get_state, _from, state) do
    {:reply, state, state}
  end

  @impl true
  def handle_cast({:set_state, new_state}, _state) do
    if DateTime.before?(DateTime.utc_now(), new_state.deadline) do
      check_countdown_status()
    end

    AppWeb.Endpoint.broadcast!("room:public", "countdown", %{countdown: new_state})
    {:noreply, new_state}
  end

  def handle_cast(:start_countdown, _state) do
    new_state = %{
      deadline: DateTime.add(DateTime.utc_now(), 5, :minute),
      running: true
    }

    check_countdown_status()
    AppWeb.Endpoint.broadcast!("room:public", "countdown", %{countdown: new_state})

    {:noreply, new_state}
  end

  def handle_cast(:stop_countdown, _state) do
    new_state = %{
      deadline: DateTime.utc_now(),
      running: false
    }

    AppWeb.Endpoint.broadcast!("room:public", "countdown", %{countdown: new_state})

    {:noreply, new_state}
  end

  @impl true
  def handle_info(:check_countdown_status, state) do
    if DateTime.before?(DateTime.utc_now(), state.deadline) do
      check_countdown_status()
      {:noreply, state}
    else
      new_state = %{
        deadline: DateTime.utc_now(),
        running: false
      }

      AppWeb.Endpoint.broadcast!("room:public", "countdown", %{countdown: new_state})
      AppWeb.Endpoint.broadcast!("room:public", "show_confetti", %{})
      {:noreply, new_state}
    end
  end

  defp check_countdown_status() do
    Process.send_after(self(), :check_countdown_status, 1000)
  end
end
