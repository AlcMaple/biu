import { marked } from "marked";

import platform from "@/platform";

import ScrollContainer from "../scroll-container";

interface Props {
  content: string;
}

const Typography = ({ content }: Props) => {
  const handleLinkClick: React.MouseEventHandler<HTMLDivElement> = e => {
    const target = (e.target as Element)?.closest("a");

    if (target && target.href) {
      e.preventDefault(); // 阻止默认行为（防止在当前窗口跳转）
      platform.openExternal(target.href); // 调用系统浏览器打开
    }
  };

  const html = marked.parse(content, { async: false }) as string;

  return (
    <ScrollContainer>
      <div
        className="prose dark:prose-invert px-6"
        onClick={handleLinkClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </ScrollContainer>
  );
};

export default Typography;
