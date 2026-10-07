import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode, RefObject } from "react";

type MenuSurfaceProps = {
  open: boolean;
  className?: string;
  innerRef?: RefObject<HTMLDivElement>;
  role?: HTMLAttributes<HTMLDivElement>["role"];
  ariaLabel?: string;
  triggerId?: string;
  style?: CSSProperties;
  children: ReactNode;
};

export function MenuSurface({
  open,
  className = "",
  innerRef,
  role = "menu",
  ariaLabel,
  triggerId,
  style,
  children,
}: MenuSurfaceProps) {
  if (!open) return null;

  return (
    <div
      ref={innerRef}
      className={["menu-surface", className, "open"].join(" ").trim()}
      role={role}
      aria-label={ariaLabel}
      data-menu-trigger={triggerId}
      style={style}
    >
      {children}
    </div>
  );
}

type MenuHeadProps = {
  className?: string;
  children: ReactNode;
};

export function MenuHead({ className = "", children }: MenuHeadProps) {
  return <div className={["menu-surface-head", className].join(" ").trim()}>{children}</div>;
}

type MenuTitleProps = {
  className?: string;
  index?: ReactNode;
  children: ReactNode;
};

export function MenuTitle({ className = "", index, children }: MenuTitleProps) {
  return (
    <span className={["menu-surface-title", className].join(" ").trim()}>
      <span>{children}</span>
      {index != null ? (
        <sup className="menu-surface-title-index" aria-hidden="true">
          {index}
        </sup>
      ) : null}
    </span>
  );
}

type MenuOptionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  tone?: "default" | "danger";
  icon?: ReactNode;
  trailing?: ReactNode;
  buttonRef?: RefObject<HTMLButtonElement>;
};

export function MenuOption({
  active = false,
  tone = "default",
  icon,
  trailing,
  buttonRef,
  className = "",
  children,
  ...buttonProps
}: MenuOptionProps) {
  return (
    <button
      ref={buttonRef}
      {...buttonProps}
      className={[
        "menu-surface-option",
        active ? "is-active" : "",
        `tone-${tone}`,
        className,
      ].join(" ").trim()}
    >
      {icon ? <span className="menu-surface-option-icon">{icon}</span> : null}
      <span className="menu-surface-option-label">{children}</span>
      {trailing ? <span className="menu-surface-option-trailing">{trailing}</span> : null}
    </button>
  );
}

type MenuDividerProps = {
  className?: string;
};

export function MenuDivider({ className = "" }: MenuDividerProps) {
  return <div className={["menu-surface-divider", className].join(" ").trim()} aria-hidden="true" />;
}

type MenuGroupProps = {
  className?: string;
  role?: HTMLAttributes<HTMLDivElement>["role"];
  ariaLabel?: string;
  children: ReactNode;
};

export function MenuGroup({ className = "", role, ariaLabel, children }: MenuGroupProps) {
  return (
    <div className={["menu-surface-group", className].join(" ").trim()} role={role} aria-label={ariaLabel}>
      {children}
    </div>
  );
}
