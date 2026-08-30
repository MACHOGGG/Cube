/**
 * The Slides web address as a QR matrix, for the corner of a share card.
 *
 * Pre-generated rather than encoded at runtime: the URL never changes per
 * player, so a hand-written encoder in the bundle would be pure risk (a
 * subtly wrong QR is worse than none) for no gain. Produced by segno
 * (version 5, error correction M) from the URL below and verified by
 * decoding the finished card back with OpenCV — regenerate the same way if
 * the address ever changes.
 *
 * Each string is one row, '1' = a dark module. The quiet zone is NOT
 * included; whoever draws it must leave a 4-module margin.
 */
export const QR_URL = 'https://play-slides.com';
export const QR_QUIET_MODULES = 4;
export const QR_MATRIX: readonly string[] = [
  '1111111011011110001111111',
  '1000001001101010001000001',
  '1011101010100101001011101',
  '1011101001111110001011101',
  '1011101001100100001011101',
  '1000001011101100101000001',
  '1111111010101010101111111',
  '0000000001000010000000000',
  '1010001101110010100100101',
  '0111010011110101101101011',
  '1000011011100001100111101',
  '0110110010101000100001000',
  '1000011011000000101000001',
  '0000010111100001101100011',
  '1100011010110011011001101',
  '0010110101000011010111000',
  '1101111001011001111110010',
  '0000000010101101100010001',
  '1111111011001000101010001',
  '1000001000011011100010011',
  '1011101001001001111110001',
  '1011101001000101010010110',
  '1011101011111100000111011',
  '1000001001000010101110000',
  '1111111010111111101001001',
];
