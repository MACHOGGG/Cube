/**
 * 小红书容器注入的那几个原生能力，包一层。
 *
 * 容器会往页面上挂一个 `window.xhs.miniTool`，里面是发笔记、存相册这些
 * （规范见 .claude/skills/minitool-zip-builder/references/jsbridge-api.md）。
 * 这个文件只做三件事：
 *
 *   1. **探测**。这几个函数只有在小红书里才存在——浏览器里、我的预览页里、
 *      Artifact 里通通没有。所以每一处调用之前都先问一句「在不在」，不在就
 *      走另一条路（见 shareActions.ts），而不是抛异常。
 *   2. **统一成 Promise**。规范说不传回调就返回 Promise，但那是「应该」；
 *      真机上万一返回了 undefined，await 一个 undefined 会当场变成
 *      undefined 而不是报错，后面的代码就悄悄跑错。这里两种写法都接住。
 *   3. **把错误变成人话**。原生返回的是 `errMsg: "postNote:fail …"`，直接
 *      弹给玩家没有意义。
 *
 * 这几个接口**我在这里测不了**——它们只存在于小红书客户端内部。所以每一处
 * 都写成「失败不炸、告诉玩家怎么办」，真正的验证在玩家的手机上。
 */

/** 容器注入的那个对象。字段照规范写，多一个都不传。 */
interface MiniTool {
  writeTempFile?: (o: { data: string }) => Promise<{ filePath: string }> | undefined;
  saveImageToPhotosAlbum?: (o: { filePath: string }) => Promise<unknown> | undefined;
  postNote?: (o: {
    title?: string;
    content?: string;
    pageType?: 'photo_publish' | 'video_publish' | 'slides_edit';
    mediaInfo: { image_resources?: { url: string }[] };
  }) => Promise<unknown> | undefined;
}

const tool = (): MiniTool | null => {
  try {
    const w = window as unknown as { xhs?: { miniTool?: MiniTool } };
    return w.xhs?.miniTool ?? null;
  } catch {
    return null;
  }
};

/** 现在是不是跑在小红书里。不在的话分享那两颗键要换个说法。 */
export function inMiniTool(): boolean {
  const t = tool();
  return !!t && (typeof t.postNote === 'function' || typeof t.saveImageToPhotosAlbum === 'function');
}

/**
 * 把「可能返回 Promise、也可能靠回调」的调用统一成 await 得到的东西。
 * 返回 undefined 的那种当作「已经发出去了，结果不可知」——按成功算，因为
 * 失败的那条路规范保证会 reject 或者走 fail。
 */
async function call<T>(fn: (() => Promise<T> | undefined) | undefined, name: string): Promise<T | undefined> {
  if (typeof fn !== 'function') throw new Error(`${name}:不可用`);
  const ret = fn();
  if (ret && typeof (ret as Promise<T>).then === 'function') return await ret;
  return undefined;
}

/** 把一张 data:uri 落成本地临时文件，换一个 filePath 回来。 */
export async function writeTempFile(dataUri: string): Promise<string> {
  const t = tool();
  // data 必须是完整的 data:uri，不能只传逗号后面那截——规范里专门写了这条
  // 错误用法。renderShareCard 吐出来的本来就是完整的，原样传。
  const res = await call<{ filePath: string }>(
    t?.writeTempFile ? () => t.writeTempFile!({ data: dataUri }) : undefined,
    'writeTempFile',
  );
  if (!res?.filePath) throw new Error('writeTempFile:没拿到 filePath');
  return res.filePath;
}

/** 存进系统相册。第一次调用可能弹权限。 */
export async function saveToAlbum(dataUri: string): Promise<void> {
  const t = tool();
  // 规范说 filePath 收 data:uri 或本地路径。先试着直接给 data:uri（少一次
  // 往返）；不成再落成临时文件重来一次——两条路都在规范里写着。
  try {
    await call(
      t?.saveImageToPhotosAlbum ? () => t.saveImageToPhotosAlbum!({ filePath: dataUri }) : undefined,
      'saveImageToPhotosAlbum',
    );
    return;
  } catch (first) {
    const filePath = await writeTempFile(dataUri).catch(() => {
      throw first;
    });
    await call(
      t?.saveImageToPhotosAlbum ? () => t.saveImageToPhotosAlbum!({ filePath }) : undefined,
      'saveImageToPhotosAlbum',
    );
  }
}

/** 标题最长 20、正文最长 1000——规范定的，超了原生会拒。 */
const TITLE_MAX = 20;
const CONTENT_MAX = 1000;
const clip = (t: string, n: number) => (t.length <= n ? t : t.slice(0, n - 1) + '…');

/** 打开发笔记页面，图片已经挂好，标题正文已经填好。 */
export async function postNote(opts: {
  title: string;
  content: string;
  imageDataUri: string;
}): Promise<void> {
  const t = tool();
  await call(
    t?.postNote
      ? () =>
          t.postNote!({
            title: clip(opts.title, TITLE_MAX),
            content: clip(opts.content, CONTENT_MAX),
            pageType: 'photo_publish',
            mediaInfo: { image_resources: [{ url: opts.imageDataUri }] },
          })
      : undefined,
    'postNote',
  );
}

/** 原生给的 errMsg 长这样：`postNote:fail xxx`。挑出后半截给玩家看。 */
export function readableError(err: unknown): string {
  const msg =
    (err as { errMsg?: string })?.errMsg ??
    (err as Error)?.message ??
    String(err ?? '');
  const cut = msg.replace(/^[\w]+:(fail|ok)\s*/, '').trim();
  return cut || '没成功，再试一次';
}
