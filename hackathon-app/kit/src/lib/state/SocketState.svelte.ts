import { Socket } from "phoenix";
import type { Channel } from "phoenix";
import { appCurrentUser } from "$lib/state/CurrentUserState.svelte";

declare global {
  interface Window {
    socket: Socket;
  }
}

export interface Hack {
  id: string;
  name: string;
  description: string;
  categories: {
    id: string;
    name: string;
    votes: number;
  }[];
}

export interface HackWithRank {
  id: string;
  name: string;
  description: string;
  votes: number;
  rank: number;
}

interface Category {
  id: string;
  name: string;
  hacks: HackWithRank[];
}

interface Vote {
  category_id: string;
  hack_id: string;
}

class SocketState {
  publicChannel: Channel | undefined;
  userChannel: Channel | undefined;

  hacks = $state<Hack[]>([]);
  categories = $state<Category[]>([]);

  userVotes = $state<Vote[]>([]);

  countdown = $state<{
    deadline: Date;
    running: boolean;
    minutes: number;
    seconds: number;
  }>({
    deadline: new Date(),
    running: false,
    minutes: 0,
    seconds: 0,
  });

  countdownAtZero = $derived<boolean>(this.countdown.seconds === 0 && this.countdown.minutes === 0);
  showConfetti = $state<boolean>(false);
  mounted = $state<boolean>(false);

  connect = () => {
    const socket = new Socket("/socket", { params: { token: appCurrentUser.user?.token } });
    socket.connect();
    window.socket = socket;

    this.publicChannel = socket.channel("room:public", {});
    this.publicChannel
      .join()
      .receive(
        "ok",
        (resp: {
          hacks: Hack[];
          categories: Category[];
          countdown: { deadline: string; running: boolean };
        }) => {
          this.hacks = resp.hacks;
          this.categories = resp.categories;
          this.countdown = {
            deadline: new Date(resp.countdown.deadline),
            running: resp.countdown.running,
            minutes: 0,
            seconds: 0,
          };
          this.mounted = true;
        },
      )
      .receive("error", (resp) => {
        console.log("Unable to join public channel", resp);
      });

    this.publicChannel.on("hacks", (resp: { hacks: Hack[] }) => {
      this.hacks = resp.hacks;
    });

    this.publicChannel.on("categories", (resp: { categories: Category[] }) => {
      this.categories = resp.categories;
    });

    this.publicChannel.on(
      "countdown",
      (resp: { countdown: { deadline: string; running: boolean } }) => {
        this.countdown = {
          deadline: new Date(resp.countdown.deadline),
          running: resp.countdown.running,
          minutes: 0,
          seconds: 0,
        };
      },
    );

    this.publicChannel.on("show_confetti", () => {
      this.showConfetti = true;

      setTimeout(() => {
        this.showConfetti = false;
      }, 5000);
    });

    if (appCurrentUser.user) {
      this.userChannel = socket.channel(`room:${appCurrentUser.user.id}`, {});
      this.userChannel
        .join()
        .receive("ok", (resp: { user_votes: Vote[] }) => {
          this.userVotes = resp.user_votes;
        })
        .receive("error", (resp) => {
          console.log("Unable to join user channel", resp);
        });

      this.userChannel.on("user_votes", (resp: { user_votes: Vote[] }) => {
        this.userVotes = resp.user_votes;
      });
    }
  };
}

export const appSocket = new SocketState();
