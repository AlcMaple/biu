import ReviewTab from "@/components/lyrics-align-modal/review-tab";
import ScrollContainer from "@/components/scroll-container";

const LyricsReview = () => (
  <ScrollContainer pageScroll enableBackToTop className="h-full w-full px-4">
    <div className="mb-4">
      <h1>歌词审核</h1>
      <div className="text-foreground/60 mt-1 text-sm">
        用户在「歌词逐字对齐」里提交的歌词。通过后对这个投稿的所有人生效；打回要写原因，上传者在「我的提交」里能看到
      </div>
    </div>
    <ReviewTab />
  </ScrollContainer>
);

export default LyricsReview;
