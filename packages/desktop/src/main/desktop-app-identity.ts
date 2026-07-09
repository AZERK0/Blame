export type DesktopAppIdentity = {
  appId: string;
  name: string;
};

export function desktopAppIdentity(isPackaged: boolean): DesktopAppIdentity {
  if (isPackaged) {
    return {
      appId: "dev.blame.desktop",
      name: "Blame",
    };
  }

  return {
    appId: "dev.blame.desktop.development",
    name: "Blame Dev",
  };
}