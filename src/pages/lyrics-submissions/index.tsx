import SubmissionsTab from "@/components/lyrics-align-modal/submissions-tab";
import ScrollContainer from "@/components/scroll-container";

const LyricsSubmissions = () => (
  <ScrollContainer pageScroll enableBackToTop className="h-full w-full px-4">
    <div className="mb-4">
      <h1>我的提交</h1>
      <div className="text-foreground/60 mt-1 text-sm">
        你在「歌词逐字对齐」里提交过的所有歌词和审核结果，被打回的会写明原因
      </div>
    </div>
    <SubmissionsTab />
  </ScrollContainer>
);

export default LyricsSubmissions;
