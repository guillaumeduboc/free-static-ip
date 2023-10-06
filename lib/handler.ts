export const handler = async () => {
  const ip = await fetch("https://api.ipify.org?format=json").then((res) =>
    res.json()
  );

  return ip;
};
