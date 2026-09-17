{
  description = "Headless Spicetify desktop client with TypeScript-managed WebRTC and Icecast streams";

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
      minimalFfmpeg =
        (pkgs.ffmpeg.override {
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
        }).overrideAttrs
          {
            doCheck = false;
          };
      spotifyPackage = pkgs.spotify.override {
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
      appBuildTools = [
        pkgs.esbuild
        pkgs.nodejs
        pkgs.typescript
      ];
      app = pkgs.stdenv.mkDerivation {
        pname = "spotify-headless-app";
        version = "0.1.0";
        src = nixpkgs.lib.fileset.toSource {
          root = ./.;
          fileset = nixpkgs.lib.fileset.unions [
            ./src
            ./tsconfig.json
            ./package.json
          ];
        };
        nativeBuildInputs = appBuildTools;
        dontConfigure = true;
        buildPhase = ''
          tsc -p tsconfig.json --noEmit --pretty false
          esbuild src/main.ts src/auth-capture.ts src/healthcheck.ts \
            --bundle --platform=node --format=esm --outdir=dist
        '';
        installPhase = ''
          mkdir -p $out/share/spotify-headless
          cp -r dist $out/share/spotify-headless/
        '';
      };
    in
    {
      packages.${system} = {
        inherit app;
        appBuildTools = pkgs.buildEnv {
          name = "spotify-headless-build-tools";
          paths = appBuildTools;
          pathsToLink = [ "/bin" ];
        };
        runtimeDependencies = pkgs.buildEnv {
          name = "spotify-headless-dependencies";
          paths = [
            spotifySystem.config.programs.spicetify.spicedSpotify
            pkgs.icecast
            pkgs.nodejs-slim
            pkgs.openbox
            pkgs.fontconfig
            pkgs.xkeyboard_config
          ]
          ++ map nixpkgs.lib.getBin [
            pkgs.bash
            pkgs.coreutils
            pkgs.dbus
            minimalFfmpeg
            pkgs.mediamtx
            pkgs.pulseaudio
            pkgs.xdotool
            pkgs.xorg.xkbcomp
            pkgs.xvfb
          ];
          pathsToLink = [
            "/bin"
            "/etc"
            "/share"
          ];
        };

        runtime = pkgs.buildEnv {
          name = "spotify-headless-runtime";
          paths = [
            app
            self.packages.${system}.runtimeDependencies
          ];
          pathsToLink = [
            "/bin"
            "/etc"
            "/share"
          ];
        };

        default = self.packages.${system}.runtime;
      };
    };
}
