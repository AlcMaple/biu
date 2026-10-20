import SubmissionsTab from "@/components/lyrics-align-modal/submissions-tab";
import ScrollContainer from "@/components/scroll-container";

const LyricsSubmissions = () => (
  <ScrollContainer pageScroll enableBackToTop className="h-full w-full px-4">
    <div className="mb-2">
      <h1>我的提交</h1>
      <p className="text-foreground-500 mt-1 text-sm">
        你上传的歌词和报过的时间轴错误，以及管理员的处理结果。上传的歌词通过后所有人打开这首歌都会用它。点一行可以播放这首歌
      </p>
    </div>
    <SubmissionsTab />
  </ScrollContainer>
);

export default LyricsSubmissions;
