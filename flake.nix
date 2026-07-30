{
  description = "Headless Spicetify desktop client with noVNC and low-latency Icecast streams";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    spicetify-nix = {
      url = "github:Gerg-L/spicetify-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      spicetify-nix,
    }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfree = true;
      };
      spicePkgs = spicetify-nix.legacyPackages.${system};
      minimalFfmpeg = (pkgs.ffmpeg.override {
          withHeadlessDeps = false;
          withSmallDeps = false;
          withFullDeps = false;
          withPulse = true;
          withOpus = true;
          withNetwork = true;
          withSmallBuild = true;
          buildFfmpeg = true;
          buildFfprobe = true;
          buildAvcodec = true;
          buildAvdevice = true;
          buildAvfilter = true;
          buildAvformat = true;
          buildAvutil = true;
          buildSwresample = true;
        }).overrideAttrs {
          doCheck = false;
        };
      minimalSpotifyFfmpeg = (pkgs.ffmpeg_4.override {
          withHeadlessDeps = false;
          withSmallDeps = false;
          withFullDeps = false;
          withSmallBuild = true;
          buildAvcodec = true;
          buildAvformat = true;
          buildAvutil = true;
          buildSwresample = true;
        }).overrideAttrs {
          doCheck = false;
        };
      spotifyPackage = pkgs.spotify.override {
        ffmpeg_4 = minimalSpotifyFfmpeg;
        zenity = pkgs.writeShellScriptBin "zenity" "exit 1";
      };

      spotifySystem = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          spicetify-nix.nixosModules.spicetify
          {
            nixpkgs.config.allowUnfree = true;
            system.stateVersion = "26.05";
            programs.spicetify = {
              enable = true;
              inherit spotifyPackage;
              enabledExtensions = with spicePkgs.extensions; [ adblockify ];
            };
          }
        ];
      };
    in
    {
      packages.${system} = {
        runtime = pkgs.buildEnv {
          name = "spotify-headless-runtime";
          paths = [
            spotifySystem.config.programs.spicetify.spicedSpotify
            pkgs.icecast
            pkgs.novnc
            pkgs.openbox
            pkgs.xkeyboard_config
          ] ++ map nixpkgs.lib.getBin [
            pkgs.bash
            pkgs.coreutils
            pkgs.curl
            pkgs.dbus
            minimalFfmpeg
            pkgs.fontconfig
            pkgs.gnugrep
            pkgs.gnused
            pkgs.mediamtx
            pkgs.nginx
            pkgs.pulseaudio
            pkgs.procps
            pkgs.python3Packages.supervisor
            pkgs.x11vnc
            pkgs.xdotool
            pkgs.xorg.xkbcomp
            pkgs.xdpyinfo
            pkgs.xvfb
          ];
          pathsToLink = [
            "/bin"
            "/share"
          ];
        };

        default = self.packages.${system}.runtime;
      };
    };
}
