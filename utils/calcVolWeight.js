export const calcVolumetricWeight = (l, b, h) => {
  if (!l || !b || !h) return null;
  return (l * b * h) / 5000;
};
